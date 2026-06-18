import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import { buildFromSource } from "@brick/core";
import {
  signInWithEmail,
  verifyAndBuildSession,
  AccessDeniedError,
  type BrickSession,
} from "./auth";

// grammar.js is excluded from the bundle (see esbuild.js external[]) and
// copied to out/grammar.js at build time so brick-core's parse() can find it.
// We patch the require path here before any parse call happens.
const grammarPath = path.join(__dirname, "grammar.js");
if (fs.existsSync(grammarPath)) {
  // Prime the module cache so brick-core's require("./grammar.js") resolves correctly
  require(grammarPath);
}

// ─── Auth state ──────────────────────────────────────────────────────────────

const SESSION_KEY = "brick-session";

let currentSession: BrickSession | null = null;
let diagnosticCollection: vscode.DiagnosticCollection;
let statusBarItem: vscode.StatusBarItem;

function isAuthenticated(): boolean {
  return currentSession !== null;
}

function updateStatusBar(): void {
  if (!statusBarItem) return;
  if (currentSession) {
    statusBarItem.text = `$(key) Brick: Signed in as ${currentSession.email}`;
    statusBarItem.tooltip = "Brick: Click to sign out";
    statusBarItem.command = "brick.signOut";
    statusBarItem.backgroundColor = undefined;
  } else {
    statusBarItem.text = `$(warning) Brick: Sign in required`;
    statusBarItem.tooltip = "Brick: Click to sign in";
    statusBarItem.command = "brick.signIn";
    statusBarItem.backgroundColor = new vscode.ThemeColor("statusBarItem.warningBackground");
  }
}

/** Persist session to SecretStorage. */
async function saveSession(
  secrets: vscode.SecretStorage,
  session: BrickSession
): Promise<void> {
  await secrets.store(SESSION_KEY, JSON.stringify(session));
  currentSession = session;
  updateStatusBar();
}

/** Clear session from SecretStorage. */
async function clearSession(secrets: vscode.SecretStorage): Promise<void> {
  await secrets.delete(SESSION_KEY);
  currentSession = null;
  updateStatusBar();
}

/** Try to restore a saved session on extension activate. Returns true if valid. */
async function tryRestoreSession(secrets: vscode.SecretStorage): Promise<boolean> {
  const raw = await secrets.get(SESSION_KEY);
  if (!raw) return false;

  let saved: BrickSession;
  try {
    saved = JSON.parse(raw) as BrickSession;
  } catch {
    await secrets.delete(SESSION_KEY);
    return false;
  }

  try {
    // Re-verify against Supabase to ensure token still valid
    const session = await verifyAndBuildSession(saved.access_token, saved.refresh_token);
    currentSession = session;
    updateStatusBar();
    return true;
  } catch (e) {
    // Token expired or access revoked
    await clearSession(secrets);
    if (e instanceof AccessDeniedError) {
      vscode.window.showErrorMessage(e.message);
    }
    return false;
  }
}

// ─── Lint helpers ─────────────────────────────────────────────────────────────

function lintDocument(doc: vscode.TextDocument): void {
  if (doc.languageId !== "brick") return;

  if (!isAuthenticated()) {
    // Clear any stale diagnostics but don't show auth error as a diagnostic
    diagnosticCollection.delete(doc.uri);
    return;
  }

  const source = doc.getText();
  let diagnostics: vscode.Diagnostic[] = [];

  try {
    const { diagnostics: diags } = buildFromSource(source);

    diagnostics = diags.map((d) => {
      const line = Math.max((d.line ?? 1) - 1, 0);
      const col = Math.max((d.column ?? 1) - 1, 0);
      const range = new vscode.Range(line, col, line, col + 80);

      const severity =
        d.severity === "error"
          ? vscode.DiagnosticSeverity.Error
          : d.severity === "warning"
          ? vscode.DiagnosticSeverity.Warning
          : vscode.DiagnosticSeverity.Information;

      return new vscode.Diagnostic(range, d.message, severity);
    });
  } catch {
    // silently skip parse errors during live typing
  }

  diagnosticCollection.set(doc.uri, diagnostics);
}

// ─── Auth gate helper ─────────────────────────────────────────────────────────

/** Shows an error message and returns false when the user is not authenticated. */
function requireAuth(): boolean {
  if (!isAuthenticated()) {
    vscode.window
      .showErrorMessage(
        "Sign in to Infragrid to use Brick. Run 'Brick: Sign In'.",
        "Sign In"
      )
      .then((choice) => {
        if (choice === "Sign In") {
          vscode.commands.executeCommand("brick.signIn");
        }
      });
    return false;
  }
  return true;
}

// ─── Primitive hover documentation ───────────────────────────────────────────

const PRIMITIVE_DOCS: Record<string, string> = {
  import: [
    "**`import`** — Import types and functions from another `.brick` file",
    "```brick",
    "// src/main.brick",
    "import \"./types.brick\"",
    "import \"./helpers.brick\"",
    "",
    "main() {",
    "  read_file \"/path/to/doc.pdf\" -> @text",
    "  processDoc(@text) -> @result   // function from helpers.brick",
    "  return @result",
    "}",
    "```",
    "Paths are relative to the current file. Types and functions from the imported file are available in the importing file.",
  ].join("\n"),

  module: [
    "**`module`** — Declare the module name",
    "```brick",
    "module Demo1",
    "```",
    "Placed at the top of every `.brick` file. Must match the `module` field in `brick.json`.",
  ].join("\n"),

  type: [
    "**`type`** — Define a reusable type",
    "```brick",
    "// Object type",
    "type Article = {",
    "  title: String",
    "  points: Number",
    "  author: String",
    "}",
    "",
    "// Enum type",
    "type Priority = \"low\" | \"medium\" | \"high\"",
    "```",
    "Use with **`gen`** and **`extract_table`** to enforce structured output.  \nBuilt-in primitives: `String` · `Number` · `Boolean` · `Date` · `Any`",
  ].join("\n"),

  navigate: [
    "**`navigate`** — Go to a URL",
    "```brick",
    "navigate \"https://example.com\"",
    "navigate @url",
    "```",
    "Opens the URL in the browser tab.",
  ].join("\n"),

  click: [
    "**`click`** — Click an element",
    "```brick",
    "click \"#submit-btn\"",
    "click \"Submit button\" as \"Submit\"",
    "```",
    "Click by CSS selector or by label (AI-driven). Use `as` for a display name.",
  ].join("\n"),

  fill: [
    "**`fill`** — Fill a form field",
    "```brick",
    "fill \"Email field\" with \"user@example.com\"",
    "fill \"#email\" with @emailVar -> @result",
    "```",
    "Fills a field by description or CSS selector.",
  ].join("\n"),

  select: [
    "**`select`** — Choose a dropdown option",
    "```brick",
    "select \"#country\" to \"United States\"",
    "```",
  ].join("\n"),

  press: [
    "**`press`** — Press a keyboard key",
    "```brick",
    "press Enter",
    "press \"ArrowDown\"",
    "press \"Escape\"",
    "```",
    "Common keys: `Enter` · `Tab` · `Escape` · `ArrowUp` · `ArrowDown` · `Backspace`",
  ].join("\n"),

  wait: [
    "**`wait`** — Pause execution",
    "```brick",
    "wait 1000       // 1000ms (default unit)",
    "wait 2s         // 2 seconds",
    "wait 500ms      // explicit milliseconds",
    "wait 1m         // 1 minute",
    "```",
  ].join("\n"),

  scroll: [
    "**`scroll`** — Scroll an element",
    "```brick",
    "scroll \"body\" by 300    // scroll down 300px",
    "scroll \"#list\" by -200  // scroll up 200px",
    "```",
  ].join("\n"),

  screenshot: [
    "**`screenshot`** — Capture a screenshot",
    "```brick",
    "screenshot",
    "screenshot -> @img",
    "```",
    "Stores a base64 image in `@var` when provided.",
  ].join("\n"),

  ai: [
    "**`ai`** — Free-form AI browser action",
    "```brick",
    "ai \"Click the login button\"",
    "ai \"Fill out the checkout form\" -> @result",
    "```",
    "The AI agent interprets and executes a natural language instruction on the current page.",
  ].join("\n"),

  extract_table: [
    "**`extract_table`** — Extract structured data from a page",
    "```brick",
    "// Untyped — returns {headers, rows}",
    "extract_table \"Top 10 articles with title and points\" -> @results",
    "",
    "// Typed — returns data matching your type",
    "extract_table \"Top 10 articles\" as Article[] -> @articles",
    "extract_table \"Latest news\" as NewsItem -> @item",
    "```",
    "Uses AI vision to extract tabular data. Add **`as Type`** to get structured output that matches a defined type.",
  ].join("\n"),

  extract_from: [
    "**`extract_from`** — Extract a value from a variable",
    "```brick",
    "extract_from @page \"the article title\" -> @title",
    "```",
    "Uses an LLM to extract a specific piece of information from a text or JSON variable.",
  ].join("\n"),

  gen: [
    "**`gen`** — Generate content with an LLM",
    "```brick",
    "gen \"Summarize @text\" -> @summary",
    "",
    "// Typed output — enforces structure via JSON Schema",
    "gen \"Extract article info\" as Article -> @article",
    "gen \"Find all items\" as Article[] -> @list",
    "gen \"Classify priority\" as Priority -> @level",
    "gen \"Count results\" as Number -> @count",
    "gen \"Was it found?\" as Boolean -> @found",
    "",
    "// With model override",
    "gen \"Detailed analysis\" as Article using \"gpt-4o\" -> @detailed",
    "```",
    "Calls the LLM with a prompt. Use **`as Type`** to enforce a schema — supports object types, enums, arrays, `String`, `Number`, `Boolean`, `Date`.",
  ].join("\n"),

  gen_code: [
    "**`gen_code`** — Generate and run code with an LLM",
    "```brick",
    "gen_code \"Compute Fibonacci sequence up to 100\" -> @fibs",
    "gen_code \"Parse @csvText into rows\" as Row[] -> @rows",
    "gen_code \"Summarize @data\" using \"gpt-4o\" -> @summary",
    "```",
    "Asks the LLM to write a Node.js script, runs it, and stores the output. Use **`as Type`** for structured output.",
  ].join("\n"),

  save_table: [
    "**`save_table`** — Save a table to the database",
    "```brick",
    "save_table @results \"YC Top Stories\"",
    "```",
    "Persists the table in `@var` to the Infragrid database.",
  ].join("\n"),

  read_pdf: [
    "**`read_pdf`** — Extract text from a PDF",
    "```brick",
    "// URL",
    "read_pdf \"https://example.com/report.pdf\" -> @text",
    "// Local file (macOS path)",
    "read_pdf \"/Users/you/Downloads/report.pdf\" -> @text",
    "read_pdf @pdfUrl -> @text",
    "```",
    "Supports URLs, local filesystem paths, and `data:` URIs. Falls back to OCR for scanned PDFs.",
  ].join("\n"),

  read_pdf_pages: [
    "**`read_pdf_pages`** — Extract PDF text as an array of pages",
    "```brick",
    "read_pdf_pages \"/Users/you/Downloads/report.pdf\" -> @pages",
    "read_pdf_pages @pdfUrl -> @pages",
    "",
    "// Then process each page",
    "for @page in @pages {",
    "  gen \"Summarize: @page\" as Summary -> @summary",
    "  log @summary.text",
    "}",
    "```",
    "Returns `String[]` — one entry per page. Useful for chunking large PDFs.",
  ].join("\n"),

  ocr: [
    "**`ocr`** — Extract text from an image",
    "```brick",
    "ocr \"https://example.com/scan.png\" -> @text",
    "ocr @imageUrl -> @text",
    "```",
    "Runs optical character recognition (Tesseract) on the image to extract text.",
  ].join("\n"),

  read_file: [
    "**`read_file`** — Read and extract text from any file",
    "```brick",
    "// Local file from Finder",
    "read_file \"/Users/you/Downloads/TRC AI Playbook.docx\" -> @text",
    "// URL",
    "read_file \"https://example.com/doc.docx\" -> @text",
    "// Hint the file type when the URL has no extension",
    "read_file @fileUrl as \"report.xlsx\" -> @text",
    "```",
    "Supports local paths (`/Users/...`), URLs, and `data:` URIs.  \nFormats: PDF · DOCX · XLSX · PPTX · CSV · TXT · images",
  ].join("\n"),

  read_gdoc: [
    "**`read_gdoc`** — Read a Google Doc as text",
    "```brick",
    "read_gdoc \"https://docs.google.com/document/d/.../edit\" -> @text",
    "```",
    "Fetches the plain-text content of a publicly shared Google Doc.",
  ].join("\n"),

  set_cookies: [
    "**`set_cookies`** — Inject browser cookies",
    "```brick",
    "set_cookies @cookies",
    "set_cookies \"[{\\\"name\\\": \\\"auth\\\", \\\"value\\\": \\\"token\\\", \\\"domain\\\": \\\"example.com\\\"}]\"",
    "```",
    "Injects cookies into the browser session. Useful for pre-authenticated automation.",
  ].join("\n"),

  load_excel: [
    "**`load_excel`** — Load a sheet from Excel",
    "```brick",
    "load_excel @file \"Sheet1\" -> @data",
    "```",
    "Reads one named sheet from an Excel file into a variable.",
  ].join("\n"),

  load_excel_all: [
    "**`load_excel_all`** — Load all sheets from Excel",
    "```brick",
    "load_excel_all \"https://example.com/data.xlsx\" -> @sheets",
    "```",
    "Reads all sheets. Result is a dict mapping sheet name → CSV text.",
  ].join("\n"),

  upload: [
    "**`upload`** — Upload a file to an input",
    "```brick",
    "upload @file to \"#file-input\"",
    "upload @file to \"#upload\" -> @result",
    "```",
  ].join("\n"),

  report: [
    "**`report`** — Generate a React report",
    "```brick",
    "report title: \"My Report\" {",
    "  const App = () => <div>{data.map(r => <p>{r.title}</p>)}</div>",
    "}",
    "```",
    "Generates an HTML report from a React/JSX component. Variables are injected into scope.",
  ].join("\n"),

  js: [
    "**`js`** — Run a JavaScript block",
    "```brick",
    "js {",
    "  return data.filter(x => x.points > 100);",
    "} -> @filtered",
    "```",
    "Runs a JS code block in Node.js. Use `return` to store the output.",
  ].join("\n"),

  python: [
    "**`python`** — Run a Python block",
    "```brick",
    "python {",
    "  result = [x for x in data if x['points'] > 100]",
    "} -> @filtered",
    "```",
    "Runs a Python block. Assign `result` to store the output.",
  ].join("\n"),

  if: [
    "**`if`** — Conditional branch",
    "```brick",
    "if @count > 5 {",
    "  log \"many results\"",
    "} else {",
    "  log \"few results\"",
    "}",
    "```",
    "Supports: `==` `!=` `>` `<` `>=` `<=` `not`  \nProperty access: `@var.field`",
  ].join("\n"),

  for: [
    "**`for`** — Iterate over a collection",
    "```brick",
    "for @item in @results {",
    "  log @item.title",
    "}",
    "```",
  ].join("\n"),

  repeat: [
    "**`repeat`** — Loop N times",
    "```brick",
    "repeat 5 {",
    "  scroll \"body\" by 300",
    "  wait 500",
    "}",
    "```",
  ].join("\n"),

  while: [
    "**`while`** — Loop while a condition holds",
    "```brick",
    "while @count < 10 {",
    "  @count += 1",
    "  wait 200",
    "}",
    "```",
  ].join("\n"),

  break: [
    "**`break`** — Exit a loop early",
    "```brick",
    "for @item in @list {",
    "  if @item.points > 500 { break }",
    "}",
    "```",
  ].join("\n"),

  continue: [
    "**`continue`** — Skip to next iteration",
    "```brick",
    "for @item in @list {",
    "  if @item.points == 0 { continue }",
    "  log @item.title",
    "}",
    "```",
  ].join("\n"),

  log: [
    "**`log`** — Print a value to the run log",
    "```brick",
    "log \"Starting extraction\"",
    "log @results",
    "log @item.title",
    "```",
    "Useful for debugging. Output appears in the run log panel.",
  ].join("\n"),

  fail: [
    "**`fail`** — Abort the run with an error",
    "```brick",
    "if @results == null {",
    "  fail \"No results found\"",
    "}",
    "```",
    "Stops execution and marks the run as failed.",
  ].join("\n"),

  return: [
    "**`return`** — Return the function output",
    "```brick",
    "return @results",
    "return @summary",
    "```",
    "Ends the function and sets the runbook output.",
  ].join("\n"),
};

// ─── Extension entry point ────────────────────────────────────────────────────

export function activate(context: vscode.ExtensionContext): void {
  // Status bar item
  statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
  statusBarItem.show();
  context.subscriptions.push(statusBarItem);
  updateStatusBar();

  // Diagnostic collection
  diagnosticCollection = vscode.languages.createDiagnosticCollection("brick");
  context.subscriptions.push(diagnosticCollection);

  // Lint listeners (gated inside lintDocument)
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(lintDocument),
    vscode.workspace.onDidChangeTextDocument((e) => lintDocument(e.document)),
    vscode.workspace.onDidCloseTextDocument((d) => diagnosticCollection.delete(d.uri))
  );

  // ── brick.signIn ────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("brick.signIn", async () => {
      const email = await vscode.window.showInputBox({
        prompt: "Enter your Infragrid email address",
        placeHolder: "you@example.com",
        validateInput: (v) =>
          v && v.includes("@") ? undefined : "Enter a valid email address",
      });

      if (!email) return; // user cancelled

      await vscode.window.withProgress(
        {
          location: vscode.ProgressLocation.Notification,
          title: "Brick: Sending magic link…",
          cancellable: false,
        },
        async () => {
          try {
            const session = await signInWithEmail(
              email,
              (url) => vscode.env.openExternal(vscode.Uri.parse(url))
            );
            await saveSession(context.secrets, session);
            vscode.window.showInformationMessage(
              `Signed in! Brick features enabled.`
            );
            // Re-lint any already-open brick documents now that we're authed
            vscode.workspace.textDocuments.forEach(lintDocument);
          } catch (e: unknown) {
            const err = e as Error;
            if (e instanceof AccessDeniedError) {
              await clearSession(context.secrets);
              vscode.window.showErrorMessage(err.message);
            } else {
              vscode.window.showErrorMessage(`Brick sign-in failed: ${err.message}`);
            }
          }
        }
      );
    })
  );

  // ── brick.signOut ───────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("brick.signOut", async () => {
      await clearSession(context.secrets);
      // Clear all diagnostics since features are now disabled
      diagnosticCollection.clear();
      vscode.window.showInformationMessage("Brick: Signed out.");
    })
  );

  // ── brick.build ─────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("brick.build", async () => {
      if (!requireAuth()) return;

      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "brick") {
        vscode.window.showWarningMessage("Open a .brick file first");
        return;
      }

      const source = editor.document.getText();
      const filePath = editor.document.uri.fsPath;

      try {
        const { steps, diagnostics } = buildFromSource(source);
        const errors = diagnostics.filter((d) => d.severity === "error");

        if (errors.length > 0) {
          vscode.window.showErrorMessage(`Brick build failed: ${errors[0].message}`);
          return;
        }

        const outPath = filePath.replace(/\.brick$/, ".json");
        fs.writeFileSync(outPath, JSON.stringify(steps, null, 2), "utf8");
        vscode.window.showInformationMessage(
          `Built ${steps.length} steps → ${path.basename(outPath)}`
        );
      } catch (e: unknown) {
        vscode.window.showErrorMessage(`Brick build error: ${(e as Error).message}`);
      }
    })
  );

  // ── brick.lint ──────────────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.commands.registerCommand("brick.lint", () => {
      if (!requireAuth()) return;

      const editor = vscode.window.activeTextEditor;
      if (!editor || editor.document.languageId !== "brick") {
        vscode.window.showWarningMessage("Open a .brick file first");
        return;
      }
      lintDocument(editor.document);
      vscode.window.showInformationMessage("Brick: lint complete — check Problems panel");
    })
  );

  // ── Hover documentation ─────────────────────────────────────────────────────
  context.subscriptions.push(
    vscode.languages.registerHoverProvider("brick", {
      provideHover(doc: vscode.TextDocument, pos: vscode.Position) {
        const wordRange = doc.getWordRangeAtPosition(pos, /[a-z_][a-z0-9_]*/);
        if (!wordRange) return undefined;
        const word = doc.getText(wordRange);
        const docText = PRIMITIVE_DOCS[word];
        if (!docText) return undefined;
        return new vscode.Hover(new vscode.MarkdownString(docText), wordRange);
      },
    })
  );

  // ── Restore session on activate ─────────────────────────────────────────────
  tryRestoreSession(context.secrets).then((valid) => {
    if (valid) {
      // Silently re-lint open documents now that we have a valid session
      vscode.workspace.textDocuments.forEach(lintDocument);
    } else if (currentSession === null) {
      // Only show the notification if we had a stored-but-invalid session
      // (tryRestoreSession returns false both for "nothing stored" and "invalid")
      context.secrets.get(SESSION_KEY).then((raw) => {
        if (raw) {
          // There was a stored session but it's now invalid
          vscode.window
            .showWarningMessage(
              "Brick: Your session has expired. Please sign in again.",
              "Sign In"
            )
            .then((choice) => {
              if (choice === "Sign In") {
                vscode.commands.executeCommand("brick.signIn");
              }
            });
        }
      });
    }
  });
}

export function deactivate(): void {
  diagnosticCollection?.dispose();
  statusBarItem?.dispose();
}
