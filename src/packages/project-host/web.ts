import express from "express";
import getLogger from "@cocalc/backend/logger";
import { type Client as ConatClient } from "@cocalc/conat/core/client";
import compression from "compression";
import { path as STATIC_PATH } from "@cocalc/static";
import { path as ASSET_PATH } from "@cocalc/assets";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  appendSetCookie,
  buildProjectHostBrowserSessionCookie,
  createProjectHostBrowserSessionToken,
  resolveProjectHostBrowserSessionFromCookieHeader,
} from "./browser-session";
import {
  getExamBrowserBootstrap,
  getExamBrowserSession,
  getExamRunStatusLocal,
  joinExamRun,
} from "./exam/controller";

const logger = getLogger("project-host:web");

/*
Routing contract for project-host:

- Keep this HTTP surface tiny and mostly static. Treat HTTP request bodies/params
  as untrusted hints only.
- Do NOT add project/account scoped mutating APIs here (anything that depends on
  who the user is, what projects they collaborate on, or account-level policy).
- Implement those APIs via hub conat RPC in:
    - src/packages/conat/hub/api/projects.ts (API + transform/auth mapping)
    - src/packages/project-host/hub/projects.ts (host-local implementation)
  so identity/project authorization flows through transformArgs and subject
  routing instead of ad-hoc HTTP fields.
*/
const DEFAULT_CONFIGURATION = {
  lite: false,
  project_host: true,
  site_name: "CoCalc Project Host",
};

const EXAM_ADMISSION_SCRIPT = `(() => {
  const token = new URLSearchParams(window.location.hash.slice(1)).get("token");
  if (!token) return;
  const input = document.querySelector('input[name="token"]');
  if (!(input instanceof HTMLInputElement)) return;
  input.value = token;
  window.history.replaceState(
    null,
    document.title,
    window.location.pathname + window.location.search,
  );
})();`;

export function getProjectHostCustomizePayload(opts?: {
  account_id?: string;
  project_id?: string;
  exam_mode?: boolean;
  terminal_enabled?: boolean;
  exam_session?: ReturnType<typeof getExamBrowserBootstrap>;
}) {
  return {
    configuration: {
      ...DEFAULT_CONFIGURATION,
      ...(opts?.account_id ? { account_id: opts.account_id } : {}),
      ...(opts?.project_id ? { project_id: opts.project_id } : {}),
      ...(opts?.exam_mode
        ? {
            exam_mode: true,
            registration: false,
            terminal_enabled: opts.terminal_enabled === true,
            stripe_enabled: false,
            zendesk: false,
            share_server: false,
            openai_enabled: false,
            agent_openai_codex_enabled: false,
            google_vertexai_enabled: false,
            mistral_enabled: false,
            anthropic_enabled: false,
            ollama_enabled: false,
            custom_openai_enabled: false,
          }
        : {}),
    },
    registration: false,
    strategies: [],
    software: null,
    ollama: {},
    custom_openai: {},
    ...(opts?.exam_session ? { exam_session: opts.exam_session } : {}),
  };
}

function requestHostname(req: express.Request): string {
  return `${req.headers.host ?? ""}`.trim().toLowerCase().split(":")[0];
}

function examRuntimeForRequest(req: express.Request) {
  const runtime = getExamRunStatusLocal();
  if (!runtime.hostname || requestHostname(req) !== runtime.hostname) return;
  return runtime;
}

function examSessionForRequest(req: express.Request) {
  const browser = resolveProjectHostBrowserSessionFromCookieHeader(
    req.headers.cookie,
  );
  if (!browser) return;
  return getExamBrowserSession(browser.account_id);
}

function resolveStaticPath(): string | undefined {
  const candidates = [
    process.env.COCALC_BUNDLE_DIR
      ? join(process.env.COCALC_BUNDLE_DIR, "static")
      : "",
    STATIC_PATH,
    join(__dirname, "..", "static"),
  ].filter(Boolean);
  return candidates.find((path) => existsSync(join(path, "app.html")));
}

function resolveAssetPath(): string | undefined {
  const candidates = [
    process.env.COCALC_BUNDLE_DIR
      ? join(process.env.COCALC_BUNDLE_DIR, "assets")
      : "",
    ASSET_PATH,
    join(__dirname, "..", "assets"),
  ].filter(Boolean);
  return candidates.find((path) => existsSync(path));
}

function setExamResponseHeaders(res: express.Response): void {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self' blob: data:",
      "base-uri 'none'",
      "connect-src 'self'",
      "font-src 'self' data:",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "img-src 'self' blob: data:",
      "object-src 'none'",
      "script-src 'self' 'unsafe-eval'",
      "style-src 'self' 'unsafe-inline'",
      "worker-src 'self' blob:",
    ].join("; "),
  );
  res.setHeader(
    "Permissions-Policy",
    "camera=(), geolocation=(), microphone=(), payment=(), usb=()",
  );
  // Chromium serializes the Origin header as "null" for same-origin form
  // submissions under no-referrer. Keep enough same-origin referrer context
  // for requireSameOriginPost to distinguish this page from a cross-site form.
  res.setHeader("Referrer-Policy", "same-origin");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
}

export function isExamPostOriginAllowed({
  origin,
  host,
}: {
  origin?: string;
  host?: string;
}): boolean {
  const requestHost = `${host ?? ""}`.trim().toLowerCase();
  if (!requestHost) return false;
  try {
    const parsed = new URL(`${origin ?? ""}`.trim());
    if (parsed.host.toLowerCase() !== requestHost) return false;
    if (parsed.protocol === "https:") return true;
    const hostname = parsed.hostname.toLowerCase();
    return (
      parsed.protocol === "http:" &&
      (hostname === "localhost" || hostname === "127.0.0.1")
    );
  } catch {
    return false;
  }
}

function requireSameOriginPost(req: express.Request): void {
  if (
    !isExamPostOriginAllowed({
      origin: Array.isArray(req.headers.origin)
        ? req.headers.origin[0]
        : req.headers.origin,
      host: req.headers.host,
    })
  ) {
    throw new Error("exam admission requires a same-origin request");
  }
}

function requestSource(req: express.Request): string {
  const value =
    req.headers["cf-connecting-ip"] ??
    req.headers["x-forwarded-for"] ??
    req.ip ??
    "unknown";
  const first = Array.isArray(value) ? value[0] : `${value}`.split(",")[0];
  return `${first ?? "unknown"}`.trim().slice(0, 128) || "unknown";
}

export function getExamJoinPage({
  error,
  admission_open,
}: {
  error?: string;
  admission_open: boolean;
}): string {
  const escaped = `${error ?? ""}`
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="referrer" content="same-origin">
  <title>CoCalc Exam Scratchpad</title>
  <script src="/exam/admission.js" defer></script>
  <style>
    :root { color-scheme: light; font-family: "Avenir Next", "Segoe UI", sans-serif; }
    * { box-sizing: border-box; }
    body { margin: 0; min-height: 100vh; display: grid; place-items: center;
      color: #172235; background:
      radial-gradient(circle at 15% 15%, #d8eff2 0, transparent 38%),
      linear-gradient(145deg, #f8f3e8, #eef4f1 62%, #dce8e4); }
    main { width: min(92vw, 520px); background: rgba(255,255,255,.92);
      border: 1px solid rgba(23,34,53,.14); border-radius: 18px;
      box-shadow: 0 24px 70px rgba(23,34,53,.16); padding: 38px; }
    .eyebrow { color: #1c6b68; font-size: 12px; font-weight: 800;
      letter-spacing: .13em; text-transform: uppercase; }
    h1 { margin: 10px 0 8px; font-family: Georgia, serif; font-size: 38px; line-height: 1.05; }
    p { color: #526071; line-height: 1.55; }
    label { display: block; margin: 26px 0 8px; font-weight: 700; }
    input { width: 100%; padding: 14px 16px; border: 1px solid #9aa7af;
      border-radius: 9px; font: inherit; letter-spacing: .02em; }
    input:focus { outline: 3px solid rgba(28,107,104,.2); border-color: #1c6b68; }
    button { width: 100%; margin-top: 14px; padding: 14px 18px; border: 0;
      border-radius: 9px; color: white; background: #1c6b68; font: inherit;
      font-weight: 800; cursor: pointer; }
    button:disabled { background: #8a949a; cursor: not-allowed; }
    .error { margin-top: 18px; padding: 12px 14px; border-radius: 8px;
      color: #842626; background: #fbe6e3; }
    .closed { margin-top: 24px; padding: 14px; border-radius: 8px;
      background: #edf0f2; font-weight: 700; }
  </style>
</head>
<body><main>
  <div class="eyebrow">Private computational project</div>
  <h1>Exam Scratchpad</h1>
  ${
    admission_open
      ? `<p>Enter the token provided by your instructor. Your temporary project is erased automatically after the exam.</p>
  <form method="post" action="/exam/join">
    <label for="token">Exam token</label>
    <input id="token" name="token" type="password" autocomplete="off" required autofocus>
    <button type="submit">Open scratchpad</button>
  </form>`
      : `<p>Your instructor has prepared this exam environment, but admission is not open yet.</p>
  <div class="closed">Wait for your instructor to open admission, then refresh this page.</div>`
  }
  ${escaped ? `<div class="error" role="alert">${escaped}</div>` : ""}
</main></body></html>`;
}

function appRedirect(project_id: string): string {
  const params = new URLSearchParams({
    target: `projects/${project_id}/files`,
  });
  return `/static/app.html?${params.toString()}`;
}

export async function initHttp({
  app,
  conatClient: _, // reserved for future use
}: {
  app: express.Application;
  conatClient: ConatClient;
}) {
  app.use(compression());
  app.use(express.urlencoded({ extended: false, limit: "8kb" }));

  const staticPath = resolveStaticPath();
  const assetPath = resolveAssetPath();

  app.get("/", (req, res, next) => {
    const runtime = examRuntimeForRequest(req);
    if (!runtime) return next();
    setExamResponseHeaders(res);
    const session = examSessionForRequest(req);
    if (session) {
      res.redirect(appRedirect(session.project_id));
      return;
    }
    res.type("html").send(
      getExamJoinPage({
        admission_open: runtime.admission_open,
      }),
    );
  });

  app.get("/exam/join", (req, res, next) => {
    const runtime = examRuntimeForRequest(req);
    if (!runtime) return next();
    setExamResponseHeaders(res);
    const session = examSessionForRequest(req);
    if (session) {
      res.redirect(appRedirect(session.project_id));
      return;
    }
    res.type("html").send(
      getExamJoinPage({
        admission_open: runtime.admission_open,
      }),
    );
  });

  app.get("/exam/admission.js", (req, res, next) => {
    if (!examRuntimeForRequest(req)) return next();
    setExamResponseHeaders(res);
    res.type("application/javascript").send(EXAM_ADMISSION_SCRIPT);
  });

  app.post("/exam/join", async (req, res, next) => {
    const runtime = examRuntimeForRequest(req);
    if (!runtime) return next();
    setExamResponseHeaders(res);
    const existing = examSessionForRequest(req);
    if (existing) {
      res.redirect(appRedirect(existing.project_id));
      return;
    }
    try {
      requireSameOriginPost(req);
      const session = await joinExamRun({
        token: `${req.body?.token ?? ""}`,
        source: requestSource(req),
      });
      const ttlSeconds = Math.max(
        60,
        Math.floor((session.expires_at_ms - Date.now()) / 1000),
      );
      const sessionToken = createProjectHostBrowserSessionToken({
        account_id: session.account_id,
        ttl_seconds: ttlSeconds,
      });
      appendSetCookie(
        res,
        buildProjectHostBrowserSessionCookie({
          req,
          sessionToken,
          max_age_seconds: ttlSeconds,
        }),
      );
      res.redirect(appRedirect(session.project_id));
    } catch (err) {
      logger.warn("exam join failed", {
        source: req.ip,
        err: `${err}`,
      });
      res
        .status(400)
        .type("html")
        .send(
          getExamJoinPage({
            admission_open: runtime.admission_open,
            error: `${(err as Error)?.message ?? err}`,
          }),
        );
    }
  });

  if (staticPath) {
    app.use("/static", (req, res, next) => {
      if (!examRuntimeForRequest(req)) return next();
      setExamResponseHeaders(res);
      if (req.path === "/app.html") {
        res.setHeader("Cache-Control", "no-cache");
      }
      express.static(staticPath, {
        immutable: true,
        maxAge: "1y",
        index: false,
      })(req, res, next);
    });
  } else {
    logger.warn("exam static frontend assets are unavailable");
  }

  if (assetPath) {
    app.get("/webapp/favicon.ico", (req, res, next) => {
      if (!examRuntimeForRequest(req)) return next();
      setExamResponseHeaders(res);
      res.sendFile(join(assetPath, "favicon.ico"));
    });
    app.get("/webapp/serviceWorker.js", (req, res, next) => {
      if (!examRuntimeForRequest(req)) return next();
      setExamResponseHeaders(res);
      res.sendFile(join(assetPath, "serviceWorker.js"));
    });
    app.use("/public", (req, res, next) => {
      if (!examRuntimeForRequest(req)) return next();
      setExamResponseHeaders(res);
      express.static(join(assetPath, "public"))(req, res, next);
    });
  }

  app.get("/customize", async (req, res) => {
    const runtime = examRuntimeForRequest(req);
    if (!runtime) {
      res.json(getProjectHostCustomizePayload());
      return;
    }
    setExamResponseHeaders(res);
    const session = examSessionForRequest(req);
    res.json(
      getProjectHostCustomizePayload({
        account_id: session?.account_id,
        project_id: session?.project_id,
        exam_mode: true,
        terminal_enabled: runtime.terminal_enabled,
        exam_session: session
          ? getExamBrowserBootstrap(session.account_id)
          : undefined,
      }),
    );
  });
}

export function addCatchAll(app: express.Application) {
  app.get(/.*/, (req, res) => {
    if (req.url.endsWith("__webpack_hmr")) return;
    const runtime = examRuntimeForRequest(req);
    if (runtime) {
      const session = examSessionForRequest(req);
      if (!session) {
        res.redirect("/");
        return;
      }
      const raw = req.originalUrl || req.url || "";
      const target = raw.startsWith("/") ? raw.slice(1) : raw;
      const params = new URLSearchParams({
        target: target || `projects/${session.project_id}/files`,
      });
      res.redirect(`/static/app.html?${params.toString()}`);
      return;
    }
    logger.debug("no static frontend available for", req.url);
    res.status(404).json({
      error: "Not Found",
      detail: "Static assets are not served from project-host.",
    });
  });
}
