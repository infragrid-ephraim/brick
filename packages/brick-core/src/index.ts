export * from "./ast";
export * from "./compiler";
export * from "./serializer";
export * from "./linter";

// parse() wraps the generated Peggy parser with a clean API
// The grammar is compiled to src/grammar.js via `npm run grammar`
// For now we export a dynamic require so users import after build

export type ParseResult =
  | { ok: true; ast: import("./ast").BrickFile }
  | { ok: false; error: string; line?: number; column?: number };

export function parse(source: string): ParseResult {
  try {
    // grammar.js is copied to dist/ during build (see package.json build script)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const parser = require("./grammar.js");
    const ast = parser.parse(source, { includeLocations: true });
    return { ok: true, ast };
  } catch (e: unknown) {
    const err = e as { message?: string; location?: { start: { line: number; column: number } } };
    return {
      ok: false,
      error: err.message ?? "Unknown parse error",
      line: err.location?.start.line,
      column: err.location?.start.column,
    };
  }
}

// Convenience: parse + compile in one call
import { compile } from "./compiler";
import { lint } from "./linter";
import type { BrickFile, TopLevel } from "./ast";

export function buildFromAst(ast: BrickFile): {
  steps: import("./compiler").RunbookStep[];
  diagnostics: import("./linter").Diagnostic[];
} {
  const lintDiags = lint(ast);
  const { steps, errors } = compile(ast);
  const compileDiags: import("./linter").Diagnostic[] = errors.map(e => ({
    severity: "error" as const,
    message: e.message,
    line: e.line,
    column: e.column,
  }));
  return { steps, diagnostics: [...lintDiags, ...compileDiags] };
}

export function buildFromSource(source: string): {
  steps: import("./compiler").RunbookStep[];
  diagnostics: import("./linter").Diagnostic[];
  parseError?: string;
} {
  const parsed = parse(source);
  if (!parsed.ok) {
    return {
      steps: [],
      diagnostics: [{ severity: "error", message: parsed.error, line: parsed.line, column: parsed.column }],
      parseError: parsed.error,
    };
  }

  const lintDiags = lint(parsed.ast as BrickFile);
  const { steps, errors } = compile(parsed.ast as BrickFile);

  const compileDiags: import("./linter").Diagnostic[] = errors.map(e => ({
    severity: "error" as const,
    message: e.message,
    line: e.line,
    column: e.column,
  }));

  return { steps, diagnostics: [...lintDiags, ...compileDiags] };
}
