import type { BrickFile, Stmt, FunctionDef, Expr, Location } from "./ast";

export type Diagnostic = {
  severity: "error" | "warning" | "info";
  message: string;
  line?: number;
  column?: number;
};

export function lint(ast: BrickFile): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const definedVars = new Set<string>();
  const definedFunctions = new Set<string>();

  // Collect top-level vars
  for (const decl of ast.declarations) {
    if (decl.kind === "top_level_var") {
      definedVars.add(decl.variable);
    }
  }

  // Check for entry function
  const functions = ast.declarations.filter((d): d is FunctionDef => d.kind === "function_def");
  if (functions.length === 0) {
    diags.push({ severity: "error", message: "No function defined. Add a function like: fn main() { ... }" });
    return diags;
  }

  for (const fn of functions) {
    if (definedFunctions.has(fn.name)) {
      diags.push({
        severity: "error",
        message: `Duplicate function name: "${fn.name}"`,
        line: fn.location?.start.line,
        column: fn.location?.start.column,
      });
    }
    definedFunctions.add(fn.name);

    // Seed scope with function params
    const scope = new Set<string>(definedVars);
    for (const param of fn.params) scope.add(param.name);

    lintBody(fn.body, scope, diags);
  }

  return diags;
}

function lintBody(stmts: Stmt[], scope: Set<string>, diags: Diagnostic[]): void {
  for (const stmt of stmts) {
    lintStmt(stmt, scope, diags);
  }
}

function lintStmt(stmt: Stmt, scope: Set<string>, diags: Diagnostic[]): void {
  const loc = stmt.location;

  switch (stmt.kind) {
    // ── Browser actions ──────────────────────────────────────────────────────

    case "navigate":
      checkExpr(stmt.url, scope, diags, loc);
      break;

    case "click":
      checkExpr(stmt.selector, scope, diags, loc);
      break;

    case "fill":
      checkExpr(stmt.field, scope, diags, loc);
      checkExpr(stmt.value, scope, diags, loc);
      if (stmt.variable) scope.add(stmt.variable);
      break;

    case "type_input":
      checkExpr(stmt.selector, scope, diags, loc);
      checkExpr(stmt.text, scope, diags, loc);
      break;

    case "select":
      checkExpr(stmt.selector, scope, diags, loc);
      checkExpr(stmt.value, scope, diags, loc);
      break;

    case "scroll":
      checkExpr(stmt.selector, scope, diags, loc);
      break;

    case "press":
    case "wait":
      break;

    case "ai":
      if (!stmt.instruction.trim()) {
        diags.push({ severity: "error", message: "ai step requires a non-empty instruction", line: loc?.start.line });
      }
      if (stmt.variable) scope.add(stmt.variable);
      break;

    case "screenshot":
      if (stmt.variable) scope.add(stmt.variable);
      break;

    // ── Data extraction ──────────────────────────────────────────────────────

    case "extract_table":
      if (!stmt.description.trim()) {
        diags.push({ severity: "error", message: "extract_table requires a non-empty description", line: loc?.start.line });
      }
      scope.add(stmt.variable);
      break;

    case "extract":
      if (!scope.has(stmt.source)) {
        diags.push({
          severity: "error",
          message: `Variable @${stmt.source} is not defined`,
          line: loc?.start.line,
        });
      }
      scope.add(stmt.variable);
      break;

    // ── Gen / LLM ────────────────────────────────────────────────────────────

    case "gen":
      if (stmt.variable) scope.add(stmt.variable);
      break;

    case "gen_code":
      if (stmt.variable) scope.add(stmt.variable);
      break;

    // ── File reading ─────────────────────────────────────────────────────────

    case "read_pdf":
      checkExpr(stmt.source, scope, diags, loc);
      scope.add(stmt.variable);
      break;

    case "read_pdf_pages":
      checkExpr(stmt.source, scope, diags, loc);
      scope.add(stmt.variable);
      break;

    case "ocr_image":
      checkExpr(stmt.source, scope, diags, loc);
      scope.add(stmt.variable);
      break;

    case "open_file":
      checkExpr(stmt.source, scope, diags, loc);
      scope.add(stmt.variable);
      break;

    case "read_gdoc":
      checkExpr(stmt.url, scope, diags, loc);
      scope.add(stmt.variable);
      break;

    case "load_sheet":
      checkExpr(stmt.name, scope, diags, loc);
      scope.add(stmt.variable);
      break;

    case "set_cookies":
      checkExpr(stmt.cookies, scope, diags, loc);
      break;

    case "load_excel_all":
      checkExpr(stmt.source, scope, diags, loc);
      scope.add(stmt.variable);
      break;

    // ── Variables ────────────────────────────────────────────────────────────

    case "set_var":
      checkExpr(stmt.value, scope, diags, loc);
      scope.add(stmt.variable);
      break;

    case "compound_assign": {
      if (!scope.has(stmt.variable)) {
        diags.push({
          severity: "error",
          message: `Variable @${stmt.variable} is used before it is defined`,
          line: loc?.start.line,
        });
      }
      break;
    }

    // ── Control flow ─────────────────────────────────────────────────────────

    case "if": {
      // Lint both branches sharing the same outer scope (variables defined
      // inside branches are intentionally NOT leaked to the outer scope).
      const thenScope = new Set(scope);
      lintBody(stmt.then, thenScope, diags);
      if (stmt.else) {
        const elseScope = new Set(scope);
        lintBody(stmt.else, elseScope, diags);
      }
      break;
    }

    case "for_each": {
      checkExpr(stmt.collection, scope, diags, loc);
      // The loop variable is scoped to the body
      const loopScope = new Set(scope);
      loopScope.add(stmt.variable);
      lintBody(stmt.body, loopScope, diags);
      break;
    }

    case "pfor": {
      checkExpr(stmt.collection, scope, diags, loc);
      const pforScope = new Set(scope);
      pforScope.add(stmt.variable);
      lintBody(stmt.body, pforScope, diags);
      if (stmt.outputVar) scope.add(stmt.outputVar);
      break;
    }

    case "repeat":
      lintBody(stmt.body, new Set(scope), diags);
      break;

    case "while":
      lintBody(stmt.body, new Set(scope), diags);
      break;

    case "break":
    case "continue":
      break;

    case "log":
      checkExpr(stmt.value, scope, diags, loc);
      break;

    case "fail":
      // stmt.message is a plain string, no variable reference to check
      break;

    // ── Other ────────────────────────────────────────────────────────────────

    case "js_block":
      if (!stmt.code.trim()) {
        diags.push({ severity: "warning", message: "js block is empty", line: loc?.start.line });
      }
      checkCodeRefs(stmt.code, scope, diags, loc, "js");
      if (stmt.variable) scope.add(stmt.variable);
      break;

    case "py_block":
      if (!stmt.code.trim()) {
        diags.push({ severity: "warning", message: "python block is empty", line: loc?.start.line });
      }
      checkCodeRefs(stmt.code, scope, diags, loc, "py");
      if (stmt.variable) scope.add(stmt.variable);
      break;

    case "load_excel":
      checkExpr(stmt.file, scope, diags, loc);
      scope.add(stmt.variable);
      break;

    case "upload_file":
      checkExpr(stmt.file, scope, diags, loc);
      checkExpr(stmt.selector, scope, diags, loc);
      if (stmt.variable) scope.add(stmt.variable);
      break;

    case "report":
      checkExpr(stmt.title, scope, diags, loc);
      break;

    case "render_file":
      checkExpr(stmt.data, scope, diags, loc);
      if (stmt.variable) scope.add(stmt.variable);
      break;

    case "return":
      checkExpr(stmt.value, scope, diags, loc);
      break;
  }
}

// Scan raw JS or Python code text for @var references and verify each is in scope.
// Skips Python decorators (@name followed by `(`) — same rule as the runtime substitution.
function checkCodeRefs(
  code: string,
  scope: Set<string>,
  diags: Diagnostic[],
  loc: Location | undefined,
  lang: "js" | "py",
): void {
  const re = /@([A-Za-z_]\w*)(?!\s*\()/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const name = m[1];
    if (!scope.has(name)) {
      diags.push({
        severity: "error",
        message: `Variable @${name} is used inside a ${lang === "js" ? "js" : "python"} block but is not defined at this point`,
        line: loc?.start.line,
      });
    }
  }
}

function checkExpr(
  expr: Expr,
  scope: Set<string>,
  diags: Diagnostic[],
  loc: Location | undefined,
): void {
  if (expr.kind === "var" && !scope.has(expr.name)) {
    diags.push({
      severity: "error",
      message: `Variable @${expr.name} is used before it is defined`,
      line: loc?.start.line,
      column: loc?.start.column,
    });
  }
  if (expr.kind === "array") {
    for (const el of expr.elements) checkExpr(el, scope, diags, loc);
  }
  if (expr.kind === "object") {
    for (const { value } of expr.pairs) checkExpr(value, scope, diags, loc);
  }
  // prop refs (@var.field) — the base var must exist
  if (expr.kind === "prop" && !scope.has(expr.var)) {
    diags.push({
      severity: "error",
      message: `Variable @${expr.var} is used before it is defined`,
      line: loc?.start.line,
      column: loc?.start.column,
    });
  }
}
