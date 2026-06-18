#!/usr/bin/env node
import { program } from "commander";
import * as fs from "fs";
import * as path from "path";
import { parse, buildFromAst, buildFromSource, serialize } from "@brick/core";
import type { BrickFile, TopLevel } from "@brick/core";

// ANSI helpers
const c = {
  green:  (s: string) => `\x1b[32m${s}\x1b[0m`,
  bold:   (s: string) => `\x1b[1m${s}\x1b[0m`,
  dim:    (s: string) => `\x1b[2m${s}\x1b[0m`,
  cyan:   (s: string) => `\x1b[36m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  red:    (s: string) => `\x1b[31m${s}\x1b[0m`,
};

interface BrickJson {
  name: string;
  module: string;
  version: string;
  description: string;
  entry: string;
  author: string;
}

// Read brick.json from dir (or cwd). Returns null if not found.
function readBrickJson(dir = process.cwd()): BrickJson | null {
  const p = path.join(dir, "brick.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")) as BrickJson; }
  catch { return null; }
}

// Resolve file argument: explicit path, or auto-discover from brick.json
function resolveFile(file?: string): string {
  if (file) return file;
  const meta = readBrickJson();
  if (meta?.entry) {
    const resolved = path.resolve(meta.entry);
    if (fs.existsSync(resolved)) return meta.entry;
  }
  console.error("❌  No file specified and no brick.json found. Run: brick build src/main.brick");
  process.exit(1);
}

function loadAndParse(file: string) {
  const absPath = path.resolve(file);
  if (!fs.existsSync(absPath)) {
    console.error(`❌  File not found: ${absPath}`);
    process.exit(1);
  }
  if (!absPath.endsWith(".brick")) {
    console.error(`❌  Expected a .brick file, got: ${absPath}`);
    process.exit(1);
  }
  const source = fs.readFileSync(absPath, "utf8");
  return { source, absPath };
}

// ── Import resolution ─────────────────────────────────────────────────────────

function resolveImports(entryPath: string): BrickFile {
  const visited = new Set<string>();

  function loadFile(absPath: string): TopLevel[] {
    if (visited.has(absPath)) return [];
    visited.add(absPath);

    if (!fs.existsSync(absPath)) {
      console.error(c.red(`  ✕  Import not found: ${absPath}`));
      return [];
    }

    const src = fs.readFileSync(absPath, "utf8");
    const result = parse(src);
    if (!result.ok) {
      console.error(c.red(`  ✕  Parse error in ${absPath}: ${result.error}`));
      return [];
    }

    const decls: TopLevel[] = [];
    const dir = path.dirname(absPath);

    for (const decl of result.ast.declarations) {
      if (decl.kind === "import") {
        const importedPath = path.resolve(dir, decl.path);
        decls.push(...loadFile(importedPath));
      } else {
        decls.push(decl);
      }
    }
    return decls;
  }

  const declarations = loadFile(path.resolve(entryPath));
  return { kind: "brick_file", declarations };
}

// ── brick build ───────────────────────────────────────────────────────────────

program
  .command("build [file]")
  .description("Compile a .brick file to runbook JSON (uses brick.json entry if no file given)")
  .option("-o, --out <path>", "Output path for the JSON file")
  .option("--pretty", "Pretty-print the JSON output", true)
  .action((file: string | undefined, opts: { out?: string; pretty: boolean }) => {
    const { absPath } = loadAndParse(resolveFile(file));
    const meta = readBrickJson();
    const relSrc = path.relative(process.cwd(), absPath);
    const mergedAst = resolveImports(absPath);
    const { steps, diagnostics } = buildFromAst(mergedAst);

    const errors = diagnostics.filter(d => d.severity === "error");
    const warnings = diagnostics.filter(d => d.severity === "warning");

    if (warnings.length > 0) {
      console.log();
      warnings.forEach(w => {
        const loc = w.line ? `:${w.line}` : "";
        console.warn(c.yellow(`  ⚠  ${relSrc}${loc}  ${w.message}`));
      });
    }

    if (errors.length > 0) {
      console.log();
      console.log(c.red(c.bold("  Build failed")));
      console.log();
      errors.forEach(e => {
        const loc = e.line ? `:${e.line}` : "";
        console.error(c.red(`  ✕  ${relSrc}${loc}  ${e.message}`));
      });
      console.log();
      process.exit(1);
    }

    const json = opts.pretty
      ? JSON.stringify(steps, null, 2)
      : JSON.stringify(steps);

    const outPath = opts.out ?? absPath.replace(/\.brick$/, ".json");
    fs.writeFileSync(outPath, json, "utf8");

    const relOut = path.relative(process.cwd(), outPath);
    console.log();
    console.log(c.green(c.bold("  Build complete")));
    console.log();
    if (meta) console.log(`  ${c.dim("module")}   ${c.bold(meta.module)}  ${c.dim("v" + meta.version)}`);
    console.log(`  ${c.dim("source")}   ${relSrc}`);
    console.log(`  ${c.dim("output")}   ${relOut}`);
    console.log(`  ${c.dim("steps")}    ${c.cyan(String(steps.length))}`);
    console.log();
  });

// ── brick lint ────────────────────────────────────────────────────────────────

program
  .command("lint [file]")
  .description("Lint a .brick file (uses brick.json entry if no file given)")
  .option("--json", "Output diagnostics as JSON")
  .action((file: string | undefined, opts: { json: boolean }) => {
    const { source } = loadAndParse(resolveFile(file));
    const { diagnostics } = buildFromSource(source);

    if (opts.json) {
      console.log(JSON.stringify(diagnostics, null, 2));
      process.exit(diagnostics.some(d => d.severity === "error") ? 1 : 0);
    }

    if (diagnostics.length === 0) {
      console.log("✅  No issues found");
      return;
    }

    let hasErrors = false;
    for (const d of diagnostics) {
      const icon = d.severity === "error" ? "❌" : d.severity === "warning" ? "⚠️ " : "ℹ️ ";
      const loc = d.line ? `:${d.line}${d.column ? `:${d.column}` : ""}` : "";
      console.log(`${icon}  ${loc}  ${d.message}`);
      if (d.severity === "error") hasErrors = true;
    }

    if (hasErrors) process.exit(1);
  });

// ── brick print ───────────────────────────────────────────────────────────────

program
  .command("print [file]")
  .description("Parse and re-serialize a .brick file")
  .action((file: string | undefined) => {
    const { source } = loadAndParse(resolveFile(file));
    const { steps, diagnostics } = buildFromSource(source);

    const errors = diagnostics.filter(d => d.severity === "error");
    if (errors.length > 0) {
      errors.forEach(e => console.error(`❌  ${e.message}`));
      process.exit(1);
    }

    console.log(serialize(steps));
  });

// ── brick new ────────────────────────────────────────────────────────────────

program
  .command("new [name]")
  .description("Scaffold a new brick project: brick.json + src/main.brick")
  .action((name = "project") => {
    const projectDir = path.resolve(name);
    const srcDir = path.join(projectDir, "src");

    if (fs.existsSync(projectDir)) {
      console.error(`❌  Directory already exists: ${projectDir}`);
      process.exit(1);
    }

    fs.mkdirSync(srcDir, { recursive: true });

    const moduleName = name.charAt(0).toUpperCase() + name.slice(1).replace(/[-_]([a-z])/g, (_m: string, c: string) => c.toUpperCase());

    const meta: BrickJson = {
      name,
      module: moduleName,
      version: "0.1.0",
      description: "",
      entry: "src/main.brick",
      author: "",
    };
    fs.writeFileSync(path.join(projectDir, "brick.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");

    const template = `main() {\n  // Start writing your automation here\n  navigate "https://example.com"\n  screenshot -> @snap\n  ai "Describe what you see on the page" -> @description\n}\n`;
    fs.writeFileSync(path.join(srcDir, "main.brick"), template, "utf8");

    console.log(`✅  Created ${name}/`);
    console.log(`    brick.json`);
    console.log(`    src/main.brick`);
    console.log(`\n  Run: cd ${name} && brick build`);
  });

// ── CLI entry ─────────────────────────────────────────────────────────────────

program
  .name("brick")
  .description("The Brick DSL toolchain")
  .version("0.2.0");

program.parse(process.argv);
