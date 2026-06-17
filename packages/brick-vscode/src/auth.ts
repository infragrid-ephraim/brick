import * as http from "http";
import * as net from "net";
import { createClient } from "@supabase/supabase-js";

export const SUPABASE_URL = "https://aviqovahbgliuemcmzgk.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_qwP9g1o7TbgJm3XQYg-1vg_KBSI78Rv";

export interface BrickSession {
  access_token: string;
  refresh_token: string;
  email: string;
}

/** Find a free TCP port by binding to :0 and reading back the assigned port. */
function getFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (!addr || typeof addr === "string") {
        srv.close();
        reject(new Error("Could not get free port"));
        return;
      }
      const port = addr.port;
      srv.close(() => resolve(port));
    });
    srv.on("error", reject);
  });
}

const CALLBACK_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Brick – Signed In</title>
  <style>
    body { font-family: system-ui, sans-serif; display: flex; align-items: center;
           justify-content: center; height: 100vh; margin: 0; background: #f5f5f5; }
    .card { background: #fff; border-radius: 12px; padding: 40px 48px; text-align: center;
            box-shadow: 0 2px 16px rgba(0,0,0,0.1); max-width: 400px; }
    h1 { color: #1a1a1a; margin-bottom: 8px; font-size: 1.5rem; }
    p  { color: #555; line-height: 1.5; }
    .status { margin-top: 24px; font-size: 0.875rem; color: #888; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Signed in to Brick</h1>
    <p>You can close this tab and return to VS Code.</p>
    <div class="status" id="status">Finishing up…</div>
  </div>
  <script>
    (function () {
      var hash = window.location.hash.substring(1);
      var params = {};
      hash.split('&').forEach(function (part) {
        var kv = part.split('=');
        if (kv.length === 2) { params[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1]); }
      });
      var accessToken  = params['access_token'];
      var refreshToken = params['refresh_token'];
      if (!accessToken) {
        document.getElementById('status').textContent = 'Error: no access token in URL.';
        return;
      }
      fetch('/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ access_token: accessToken, refresh_token: refreshToken || '' })
      })
      .then(function () {
        document.getElementById('status').textContent = 'Done! You can close this tab.';
      })
      .catch(function () {
        document.getElementById('status').textContent = 'Error posting token — please try again.';
      });
    })();
  </script>
</body>
</html>`;

/**
 * Start a local HTTP server that:
 *  - Serves CALLBACK_HTML at GET /callback
 *  - Accepts the token via POST /token (JSON body)
 * Returns a promise that resolves with { access_token, refresh_token } when /token is hit,
 * or rejects after `timeoutMs` milliseconds (default 5 min).
 */
export function startCallbackServer(
  port: number,
  timeoutMs = 5 * 60 * 1000
): Promise<{ access_token: string; refresh_token: string }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let server: http.Server;

    const done = (result?: { access_token: string; refresh_token: string }, err?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close(() => {
        if (err) reject(err);
        else resolve(result!);
      });
    };

    // 5-minute safety timeout
    const timer = setTimeout(() => {
      done(undefined, new Error("Auth timeout: no token received within 5 minutes"));
    }, timeoutMs);

    server = http.createServer((req, res) => {
      // CORS headers so the browser page can POST to this local server
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");

      if (req.method === "OPTIONS") {
        res.writeHead(204);
        res.end();
        return;
      }

      const url = req.url ?? "/";

      if (req.method === "GET" && (url === "/callback" || url.startsWith("/callback?"))) {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(CALLBACK_HTML);
        return;
      }

      if (req.method === "POST" && url === "/token") {
        let body = "";
        req.on("data", (chunk) => { body += chunk; });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body) as { access_token: string; refresh_token: string };
            res.writeHead(200, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ ok: true }));
            done(payload);
          } catch {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ error: "Bad JSON" }));
          }
        });
        return;
      }

      res.writeHead(404);
      res.end("Not found");
    });

    server.on("error", (err) => done(undefined, err));
    server.listen(port, "127.0.0.1");
  });
}

/**
 * Full sign-in flow:
 *  1. Ask for email
 *  2. Send magic link (OTP)
 *  3. Start callback server
 *  4. Open browser to callback page (the link in the email redirects here)
 *  5. Receive token, verify access
 */
export async function signInFlow(
  openExternal: (url: string) => Thenable<boolean>
): Promise<BrickSession> {
  const port = await getFreePort();
  const callbackUrl = `http://localhost:${port}/callback`;

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { error: otpError } = await supabase.auth.signInWithOtp({
    email: "", // will be overridden by caller
    options: { emailRedirectTo: callbackUrl },
  });
  // Note: caller should pass email — this function is split; see signInWithEmail below.
  if (otpError) throw new Error(otpError.message);

  const tokenPayload = await startCallbackServer(port);
  return verifyAndBuildSession(tokenPayload.access_token, tokenPayload.refresh_token);
}

/** Send the OTP email, then wait for the callback. */
export async function signInWithEmail(
  email: string,
  openExternal: (url: string) => Thenable<boolean>
): Promise<BrickSession> {
  const port = await getFreePort();
  const callbackUrl = `http://localhost:${port}/callback`;

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // Start listening BEFORE sending the email so we don't miss the redirect
  const serverPromise = startCallbackServer(port);

  const { error: otpError } = await supabase.auth.signInWithOtp({
    email,
    options: { emailRedirectTo: callbackUrl },
  });
  if (otpError) throw new Error(otpError.message);

  // Open a holding page — the real token arrives via the emailed link
  await openExternal(`http://localhost:${port}/callback`);

  const tokenPayload = await serverPromise;
  return verifyAndBuildSession(tokenPayload.access_token, tokenPayload.refresh_token);
}

/** Verify the access token against Supabase and check the profiles.access field. */
export async function verifyAndBuildSession(
  access_token: string,
  refresh_token: string
): Promise<BrickSession> {
  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  const { data: userData, error: userError } = await supabase.auth.getUser(access_token);
  if (userError || !userData.user) {
    throw new Error("Invalid session token. Please sign in again.");
  }

  const user = userData.user;
  const email = user.email ?? "";

  const { data: profile } = await supabase
    .from("profiles")
    .select("access")
    .eq("id", user.id)
    .maybeSingle();

  if (profile && profile.access === false) {
    throw new AccessDeniedError(
      "Your account hasn't been granted access. Contact your admin."
    );
  }

  return { access_token, refresh_token, email };
}

/** Thrown when the user's profiles.access field is false. */
export class AccessDeniedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AccessDeniedError";
  }
}
