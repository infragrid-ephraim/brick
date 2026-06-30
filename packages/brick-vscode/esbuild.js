const esbuild = require("esbuild");
const path = require("path");
const fs = require("fs");

const watch = process.argv.includes("--watch");

/** Copy grammar.js from brick-core/dist into out/ so the bundle can require it at runtime */
function copyGrammar() {
  const coreRoot = path.dirname(require.resolve("@brick/core/package.json"));
  const src = path.join(coreRoot, "dist", "grammar.js");
  const dest = path.join(__dirname, "out", "grammar.js");
  fs.mkdirSync(path.join(__dirname, "out"), { recursive: true });
  fs.copyFileSync(src, dest);
  console.log("Copied grammar.js →", dest);
}

/** Copy brick.mdc Cursor rules into out/ so the installCursorRules command can read it */
function copyCursorRules() {
  const src = path.join(__dirname, "..", "..", ".cursor", "rules", "brick.mdc");
  const dest = path.join(__dirname, "out", "brick.mdc");
  if (fs.existsSync(src)) {
    fs.copyFileSync(src, dest);
    console.log("Copied brick.mdc →", dest);
  }
}

const ctx = esbuild.context({
  entryPoints: ["src/extension.ts"],
  bundle: true,
  outfile: "out/extension.js",
  external: [
    "vscode",          // provided by the VS Code host
    "./grammar.js",    // loaded at runtime via require(), copied separately
  ],
  format: "cjs",
  platform: "node",
  target: "node18",
  sourcemap: true,
  minify: false,
  logLevel: "info",
});

ctx.then(async (c) => {
  copyGrammar();
  copyCursorRules();
  if (watch) {
    await c.watch();
    console.log("Watching…");
  } else {
    await c.rebuild();
    await c.dispose();
    console.log("Bundle complete.");
  }
}).catch(() => process.exit(1));
