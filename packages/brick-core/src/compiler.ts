import type { BrickFile, Stmt, Expr, FunctionDef, TopLevelVar, TypeAnnotation, TypeDef, EnumTypeDef } from "./ast";

// Mirrors the RunbookStep type from the app
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyObj = Record<string, any>;

export type RunbookStep =
  | { type: "action";          instruction: string; variable: string }
  | { type: "navigate";        url: string }
  | { type: "click";           selector: string; label: string }
  | { type: "set_input";       field: string; value: string; variable: string }
  | { type: "type";            selector: string; text: string }
  | { type: "set_dropdown";    selector: string; value: string }
  | { type: "press_key";       key: string }
  | { type: "wait";            ms: number }
  | { type: "scroll";          selector: string; deltaY: number }
  | { type: "screenshot";      variable: string }
  | { type: "extract_table";   description: string; variable: string; output_schema?: AnyObj; output_schema_wrap?: string }
  | { type: "set_variable";    variable: string; value: string }
  | { type: "store_table";     variable: string; name: string }
  | { type: "extract";         source: string; query: string; variable: string }
  | { type: "write_docx";      title: string; content: string }
  | { type: "js_block";        code: string; variable: string }
  | { type: "py_block";        code: string; variable: string }
  | { type: "excel_to_csv";    file: string; sheet: string; variable: string }
  | { type: "upload_file";     file: string; selector: string; variable: string }
  | { type: "compound_assign"; variable: string; op: string; value: string }
  | { type: "log";             value: string }
  | { type: "fail";            message: string }
  | { type: "break" }
  | { type: "continue" }
  | { type: "if";              condition: AnyObj; then: RunbookStep[]; else: RunbookStep[] }
  | { type: "for_each";        variable: string; collection: string; body: RunbookStep[] }
  | { type: "repeat";          count: number; body: RunbookStep[] }
  | { type: "while";           condition: AnyObj; body: RunbookStep[] }
  | { type: "gen_primitive";   prompt: string; model?: string; variable?: string; output_schema?: AnyObj; output_schema_wrap?: string }
  | { type: "gen_with_code";   prompt: string; model?: string; variable?: string; output_schema?: AnyObj; output_schema_wrap?: string }
  | { type: "set_cookies";     cookies: string }
  | { type: "excel_to_csvs";   source: string; variable: string }
  | { type: "read_pdf";        source: string; variable: string }
  | { type: "read_pdf_pages";  source: string; variable: string }
  | { type: "ocr_image";       source: string; variable: string }
  | { type: "read_file";       source: string; filename?: string; variable: string }
  | { type: "read_gdoc";       url: string; variable: string };

export type CompileResult = {
  steps: RunbookStep[];
  errors: CompileError[];
  topLevelVars: Record<string, unknown>;
  entryFunction?: FunctionDef;
};

export type CompileError = {
  message: string;
  line?: number;
  column?: number;
};

function resolveExpr(expr: Expr): string {
  switch (expr.kind) {
    case "string": return expr.value;
    case "number": return String(expr.value);
    case "bool":   return String(expr.value);
    case "null":   return "null";
    case "var":    return `@${expr.name}`;
    case "prop":   return `@${(expr as AnyObj).var}.${(expr as AnyObj).prop}`;
    case "array":  return JSON.stringify(resolveExprValue(expr));
    case "object": return JSON.stringify(resolveExprValue(expr));
  }
}

function resolveExprValue(expr: Expr): unknown {
  switch (expr.kind) {
    case "string": return expr.value;
    case "number": return expr.value;
    case "bool":   return expr.value;
    case "null":   return null;
    case "var":    return `@${expr.name}`;
    case "array":  return expr.elements.map(resolveExprValue);
    case "object": {
      const obj: Record<string, unknown> = {};
      for (const { key, value } of expr.pairs) obj[key] = resolveExprValue(value);
      return obj;
    }
  }
}

function compileStmt(stmt: Stmt, errors: CompileError[], typeDefs: TypeDefMap = new Map()): RunbookStep | null {
  switch (stmt.kind) {
    case "navigate":
      return { type: "navigate", url: resolveExpr(stmt.url) };

    case "click":
      return { type: "click", selector: resolveExpr(stmt.selector), label: stmt.label ?? "" };

    case "fill":
      return {
        type: "set_input",
        field: resolveExpr(stmt.field),
        value: resolveExpr(stmt.value),
        variable: stmt.variable ?? "",
      };

    case "type_input":
      return { type: "type", selector: resolveExpr(stmt.selector), text: resolveExpr(stmt.text) };

    case "select":
      return { type: "set_dropdown", selector: resolveExpr(stmt.selector), value: resolveExpr(stmt.value) };

    case "press":
      return { type: "press_key", key: stmt.key };

    case "wait":
      return { type: "wait", ms: stmt.ms };

    case "scroll":
      return { type: "scroll", selector: resolveExpr(stmt.selector), deltaY: stmt.deltaY };

    case "screenshot":
      return { type: "screenshot", variable: stmt.variable ?? "" };

    case "ai":
      return { type: "action", instruction: stmt.instruction, variable: stmt.variable ?? "" };

    case "extract_table": {
      const step: AnyObj = { type: "extract_table", description: stmt.description, variable: stmt.variable };
      if (stmt.outputType) {
        const { schema, wrap } = buildOutputSchema(stmt.outputType, typeDefs);
        step.output_schema = schema;
        if (wrap) step.output_schema_wrap = wrap;
      }
      return step as RunbookStep;
    }

    case "set_var": {
      const raw = resolveExprValue(stmt.value);
      return {
        type: "set_variable",
        variable: stmt.variable,
        value: typeof raw === "string" ? raw : JSON.stringify(raw),
      };
    }

    case "save_table":
      return { type: "store_table", variable: stmt.variable, name: stmt.name };

    case "extract":
      return { type: "extract", source: stmt.source, query: stmt.query, variable: stmt.variable };

    case "js_block":
      return { type: "js_block", code: stmt.code, variable: stmt.variable ?? "" };

    case "py_block":
      return { type: "py_block", code: stmt.code, variable: stmt.variable ?? "" };

    case "load_excel":
      return {
        type: "excel_to_csv",
        file: resolveExpr(stmt.file),
        sheet: stmt.sheet,
        variable: stmt.variable,
      };

    case "upload_file":
      return {
        type: "upload_file",
        file: resolveExpr(stmt.file),
        selector: resolveExpr(stmt.selector),
        variable: stmt.variable ?? "",
      };

    case "report":
      return { type: "write_docx", title: resolveExpr(stmt.title), content: stmt.content };

    case "return":
      return null;

    case "gen": {
      const step: AnyObj = { type: "gen_primitive", prompt: stmt.prompt, model: stmt.model, variable: stmt.variable };
      if (stmt.outputType) {
        const { schema, wrap } = buildOutputSchema(stmt.outputType, typeDefs);
        step.output_schema = schema;
        if (wrap) step.output_schema_wrap = wrap;
      }
      return step as RunbookStep;
    }

    case "gen_code": {
      const step: AnyObj = { type: "gen_with_code", prompt: stmt.prompt, model: stmt.model, variable: stmt.variable };
      if (stmt.outputType) {
        const { schema, wrap } = buildOutputSchema(stmt.outputType, typeDefs);
        step.output_schema = schema;
        if (wrap) step.output_schema_wrap = wrap;
      }
      return step as RunbookStep;
    }

    case "set_cookies":
      return { type: "set_cookies", cookies: resolveExpr(stmt.cookies) };

    case "load_excel_all":
      return { type: "excel_to_csvs", source: resolveExpr(stmt.source), variable: stmt.variable };

    case "read_pdf":
      return { type: "read_pdf", source: resolveExpr(stmt.source), variable: stmt.variable };

    case "read_pdf_pages":
      return { type: "read_pdf_pages", source: resolveExpr(stmt.source), variable: stmt.variable };

    case "ocr_image":
      return { type: "ocr_image", source: resolveExpr(stmt.source), variable: stmt.variable };

    case "read_file":
      return { type: "read_file", source: resolveExpr(stmt.source), filename: stmt.filename, variable: stmt.variable };

    case "read_gdoc":
      return { type: "read_gdoc", url: resolveExpr(stmt.url), variable: stmt.variable };

    case "if": {
      const s = stmt as AnyObj;
      return {
        type: "if",
        condition: resolveCondition(s.condition),
        then: compileBody(s.then, errors, typeDefs),
        else: Array.isArray(s.else) ? compileBody(s.else, errors, typeDefs) : [],
      };
    }

    case "for_each": {
      const s = stmt as AnyObj;
      return { type: "for_each", variable: s.variable, collection: resolveExpr(s.collection), body: compileBody(s.body, errors, typeDefs) };
    }

    case "repeat": {
      const s = stmt as AnyObj;
      return { type: "repeat", count: s.count, body: compileBody(s.body, errors, typeDefs) };
    }

    case "while": {
      const s = stmt as AnyObj;
      return { type: "while", condition: resolveCondition(s.condition), body: compileBody(s.body, errors, typeDefs) };
    }

    case "break":    return { type: "break" };
    case "continue": return { type: "continue" };

    case "log": {
      const s = stmt as AnyObj;
      return { type: "log", value: resolveExpr(s.value) };
    }

    case "fail": {
      const s = stmt as AnyObj;
      return { type: "fail", message: s.message };
    }

    case "compound_assign": {
      const s = stmt as AnyObj;
      return { type: "compound_assign", variable: s.variable, op: s.op, value: resolveExpr(s.value) };
    }
  }
}

function resolveCondition(cond: AnyObj): AnyObj {
  if (cond.kind === "compare") {
    return { op: cond.op, left: resolveCondAtom(cond.left), right: resolveCondAtom(cond.right) };
  }
  if (cond.kind === "not") {
    return { op: "not", expr: resolveCondAtom(cond.expr) };
  }
  return resolveCondAtom(cond);
}

function resolveCondAtom(atom: AnyObj): AnyObj {
  if (atom.kind === "var")    return { type: "var", name: atom.name };
  if (atom.kind === "prop")   return { type: "prop", var: atom.var, prop: atom.prop };
  if (atom.kind === "string") return { type: "literal", value: atom.value };
  if (atom.kind === "number") return { type: "literal", value: atom.value };
  if (atom.kind === "bool")   return { type: "literal", value: atom.value };
  if (atom.kind === "null")   return { type: "literal", value: null };
  return atom;
}

type TypeDefMap = Map<string, TypeDef | EnumTypeDef>;

function typeToJsonSchema(ann: TypeAnnotation, defs: TypeDefMap): AnyObj {
  if (ann.kind === "array_type") {
    return { type: "array", items: typeToJsonSchema(ann.element, defs) };
  }
  switch (ann.name) {
    case "String":  return { type: "string" };
    case "Number":  return { type: "number" };
    case "Boolean": return { type: "boolean" };
    case "Date":    return { type: "string", format: "date-time" };
    case "Any":     return {};
    default: {
      const def = defs.get(ann.name);
      if (!def) return { type: "string" };
      if (def.kind === "enum_def") {
        return { type: "string", enum: def.variants };
      }
      const properties: AnyObj = {};
      const required: string[] = [];
      for (const f of def.fields) {
        properties[f.name] = typeToJsonSchema(f.type, defs);
        required.push(f.name);
      }
      return { type: "object", properties, required, additionalProperties: false };
    }
  }
}

function buildOutputSchema(ann: TypeAnnotation, defs: TypeDefMap): { schema: AnyObj; wrap?: string } {
  const schema = typeToJsonSchema(ann, defs);
  if (schema.type === "object") return { schema };
  // OpenAI structured output requires root object — wrap primitives and arrays
  return {
    schema: { type: "object", properties: { result: schema }, required: ["result"], additionalProperties: false },
    wrap: "result",
  };
}

function compileBody(stmts: Stmt[], errors: CompileError[] = [], typeDefs: TypeDefMap = new Map()): RunbookStep[] {
  return stmts.flatMap(s => {
    const step = compileStmt(s, errors, typeDefs);
    return step ? [step] : [];
  });
}

export function compile(ast: BrickFile): CompileResult {
  const errors: CompileError[] = [];
  const topLevelVars: Record<string, unknown> = {};
  const typeDefs: TypeDefMap = new Map();
  let entryFunction: FunctionDef | undefined;

  // Collect top-level vars
  for (const decl of ast.declarations) {
    if (decl.kind === "type_def" || decl.kind === "enum_def") {
      typeDefs.set(decl.name, decl);
    }
    if (decl.kind === "top_level_var") {
      topLevelVars[decl.variable] = resolveExprValue(decl.value);
    }
    if (decl.kind === "function_def") {
      // The first function_def (usually "main") is the entry point
      if (!entryFunction) entryFunction = decl;
    }
  }

  if (!entryFunction) {
    errors.push({ message: "No function found in brick file. Define at least one function." });
    return { steps: [], errors, topLevelVars };
  }

  const steps: RunbookStep[] = [];
  for (const stmt of entryFunction.body) {
    const step = compileStmt(stmt, errors, typeDefs);
    if (step) steps.push(step);
  }

  return { steps, errors, topLevelVars, entryFunction };
}
