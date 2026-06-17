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
