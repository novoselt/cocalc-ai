#!/usr/bin/env node

import { spawn, execFile } from "node:child_process";
import { access, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createRequire } from "node:module";

import lighthouse, { desktopConfig, generateReport } from "lighthouse";

import {
  createPageSummary,
  helpText,
  loadPageMatrix,
  parseArgs,
  renderMarkdownSummary,
  resolvePageUrl,
  selectPages,
} from "./lib.mjs";

const execFileAsync = promisify(execFile);
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = resolve(SCRIPT_DIR, "../..");
const DEFAULT_CONFIG = join(SCRIPT_DIR, "pages.json");

function timestamp() {
  return new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replace(/\.\d+Z$/, "Z");
}

async function resolveExecutable(explicitPath) {
  const candidates = [
    explicitPath,
    process.env.CHROME_BIN,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    "/usr/local/bin/chromium-browser",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ].filter(Boolean);
  for (const path of candidates) {
    try {
      await access(path);
      return path;
    } catch {
      // Try the next conventional location.
    }
  }
  throw new Error(
    `unable to find Chromium; pass --chromium PATH (checked ${candidates.join(", ")})`,
  );
}

async function loadPlaywright() {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("playwright-core", {
    paths: [join(SRC_ROOT, "packages/cli/node_modules")],
  });
  const imported = await import(pathToFileURL(entry).href);
  return imported.default ?? imported["module.exports"] ?? imported;
}

async function reservePort() {
  return await new Promise((resolvePort, reject) => {
    const server = createServer();
    server.unref();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" ? address?.port : undefined;
      server.close((error) => {
        if (error) reject(error);
        else if (!port) reject(new Error("unable to reserve Chromium port"));
        else resolvePort(port);
      });
    });
  });
}

async function waitForDevTools(port, child, stderr) {
  const deadline = Date.now() + 30_000;
  const endpoint = `http://127.0.0.1:${port}/json/version`;
  while (Date.now() < deadline) {
    if (child.exitCode != null) {
      throw new Error(
        `Chromium exited with ${child.exitCode}: ${stderr().slice(-2000)}`,
      );
    }
    try {
      const response = await fetch(endpoint);
      if (response.ok) return endpoint;
    } catch {
      // Chromium is still starting.
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 100));
  }
  throw new Error(
    `timed out waiting for Chromium DevTools: ${stderr().slice(-2000)}`,
  );
}

async function launchChromium(options) {
  const executablePath = await resolveExecutable(options.chromiumPath);
  const profileDir =
    options.profileDir ??
    (await mkdtemp(join(tmpdir(), "cocalc-accessibility-")));
  const port = await reservePort();
  const args = [
    options.headed ? undefined : "--headless=new",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    "--no-sandbox",
    "--disable-dev-shm-usage",
    "--disable-extensions",
    "--no-default-browser-check",
    "--no-first-run",
    "--window-size=1440,1000",
    "about:blank",
  ].filter(Boolean);
  const child = spawn(executablePath, args, {
    stdio: ["ignore", "ignore", "pipe"],
  });
  let stderr = "";
  child.stderr?.on("data", (chunk) => {
    stderr += chunk.toString();
    if (stderr.length > 20_000) stderr = stderr.slice(-20_000);
  });
  try {
    await waitForDevTools(port, child, () => stderr);

    const { chromium } = await loadPlaywright();
    const browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`);
    const context = browser.contexts()[0];
    if (!context) {
      throw new Error("Chromium did not expose its persistent browser context");
    }
    const page = context.pages()[0] ?? (await context.newPage());

    return {
      browser,
      child,
      context,
      executablePath,
      page,
      port,
      profileDir,
      temporaryProfile: options.profileDir == null,
    };
  } catch (error) {
    if (child.exitCode == null) child.kill("SIGKILL");
    if (options.profileDir == null) {
      await rm(profileDir, { recursive: true, force: true });
    }
    throw error;
  }
}

async function stopChromium(chrome, keepProfile) {
  await chrome.browser.close().catch(() => undefined);
  if (chrome.child.exitCode == null) {
    chrome.child.kill("SIGTERM");
    await new Promise((resolveWait) => {
      const timeout = setTimeout(resolveWait, 2000);
      chrome.child.once("exit", () => {
        clearTimeout(timeout);
        resolveWait();
      });
    });
  }
  if (chrome.child.exitCode == null) chrome.child.kill("SIGKILL");
  if (chrome.temporaryProfile && !keepProfile) {
    await rm(chrome.profileDir, {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 200,
    });
  }
}

async function loadDevEnvironment(mode) {
  const script = join(SRC_ROOT, "scripts/dev/dev-env.js");
  const { stdout } = await execFileAsync(process.execPath, [
    script,
    mode,
    "--json",
    "--with-browser",
  ]);
  return JSON.parse(stdout);
}

function environmentForCli(devEnv) {
  const env = {
    ...process.env,
    ...(devEnv.exports ?? {}),
  };
  if (devEnv.path_prepend) {
    env.PATH = `${devEnv.path_prepend}:${process.env.PATH ?? ""}`;
  }
  return env;
}

async function runLocalCli(devEnv, accountId, args) {
  const cliBin = `${devEnv.cli_bin ?? ""}`.trim();
  if (!cliBin) {
    throw new Error("local dev environment did not provide a CLI binary");
  }
  const apiUrl = `${devEnv.api_url ?? ""}`.trim();
  const { stdout } = await execFileAsync(
    process.execPath,
    [
      cliBin,
      "--json",
      "--profile",
      "accessibility-audit",
      "--api",
      apiUrl,
      "--account-id",
      accountId,
      "--disable-env-auth-defaults",
      ...args,
    ],
    {
      env: environmentForCli(devEnv),
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  const payload = JSON.parse(stdout);
  if (payload?.ok !== true) {
    throw new Error(
      payload?.error?.message ?? `cocalc ${args.join(" ")} failed`,
    );
  }
  return payload.data ?? {};
}

async function issueLocalLoginUrl(devEnv, baseUrl) {
  const accountId = `${
    devEnv.exports?.COCALC_ACCOUNT_ID ?? process.env.COCALC_ACCOUNT_ID ?? ""
  }`.trim();
  if (!devEnv.cli_bin || !accountId) {
    throw new Error(
      "authenticated audits need --login-url or a local hub dev environment with an account",
    );
  }
  const apiUrl = `${devEnv.api_url ?? ""}`.trim();
  const apiHost = apiUrl ? new URL(apiUrl).hostname : "";
  if (apiHost !== "localhost" && apiHost !== "127.0.0.1" && apiHost !== "::1") {
    throw new Error(
      "automatic audit login is restricted to a loopback local hub; pass --login-url for other sites",
    );
  }

  await runLocalCli(devEnv, accountId, ["auth", "elevate", "--dev"]);
  const data = await runLocalCli(devEnv, accountId, [
    "admin",
    "user",
    "issue-impersonation-link",
    accountId,
  ]);
  if (!data.url) throw new Error("failed to issue local audit login URL");
  const issued = new URL(data.url);
  return new URL(
    `${issued.pathname}${issued.search}${issued.hash}`,
    baseUrl,
  ).toString();
}

async function authenticate(page, loginUrl) {
  await page.goto(loginUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page
    .waitForLoadState("networkidle", { timeout: 10_000 })
    .catch(() => undefined);
  await page.waitForTimeout(1000);
}

async function warmPage(page, pageConfig, url) {
  await page.goto(url, {
    waitUntil: "domcontentloaded",
    timeout: 120_000,
  });
  if (pageConfig.readySelector) {
    await page.waitForSelector(pageConfig.readySelector, {
      state: "visible",
      timeout: 90_000,
    });
  }
  await page.waitForTimeout(pageConfig.settleMs ?? 1000);
}

async function auditPage(chrome, pageConfig, url, verbose) {
  await warmPage(chrome.page, pageConfig, url);
  const result = await lighthouse(
    url,
    {
      port: chrome.port,
      logLevel: verbose ? "info" : "error",
      onlyCategories: ["accessibility"],
      disableStorageReset: true,
      maxWaitForLoad: 120_000,
      throttlingMethod: "provided",
      formFactor: "desktop",
      screenEmulation: {
        mobile: false,
        width: 1440,
        height: 1000,
        deviceScaleFactor: 1,
        disabled: false,
      },
    },
    desktopConfig,
  );
  if (!result?.lhr) {
    throw new Error(`Lighthouse returned no result for ${url}`);
  }
  return result.lhr;
}

function safeId(value) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

async function writePageReports(outputDir, pageId, lhr) {
  const prefix = join(outputDir, safeId(pageId));
  await writeFile(`${prefix}.json`, `${JSON.stringify(lhr, null, 2)}\n`);
  await writeFile(`${prefix}.html`, generateReport(lhr, "html"));
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(helpText());
    return;
  }

  const configPath = resolve(options.configPath ?? DEFAULT_CONFIG);
  const pages = selectPages(await loadPageMatrix(configPath), options);
  if (pages.length === 0) throw new Error("no pages selected");

  const requiresProject = pages.some(({ requiresProject }) => requiresProject);
  const devEnv = await loadDevEnvironment(options.mode).catch((error) => {
    if (options.baseUrl && (!requiresProject || options.projectId)) return {};
    throw error;
  });
  const baseUrl = `${
    options.baseUrl ??
    process.env.COCALC_ACCESSIBILITY_BASE_URL ??
    devEnv.browser_base_url ??
    devEnv.api_url ??
    ""
  }`.trim();
  if (!baseUrl) {
    throw new Error("unable to resolve site URL; pass --base-url");
  }
  const projectId = `${
    options.projectId ??
    devEnv.project_id ??
    process.env.COCALC_PROJECT_ID ??
    ""
  }`.trim();

  const outputDir = resolve(
    options.outputDir ?? join(SRC_ROOT, ".local/accessibility", timestamp()),
  );
  await mkdir(outputDir, { recursive: true });

  const requiresAuth = pages.some(
    ({ authentication }) => authentication !== "none",
  );
  let loginUrl = options.loginUrl;
  if (requiresAuth && options.authenticate && !loginUrl) {
    loginUrl = await issueLocalLoginUrl(devEnv, baseUrl);
  }
  if (requiresAuth && options.authenticate === false) {
    process.stderr.write(
      "Warning: authenticated pages selected with --no-auth\n",
    );
  }

  const chrome = await launchChromium(options);
  const summaries = [];
  try {
    process.stdout.write(
      `Chromium: ${chrome.executablePath}\nReports: ${outputDir}\n`,
    );
    if (loginUrl) await authenticate(chrome.page, loginUrl);

    for (const pageConfig of pages) {
      const url = resolvePageUrl(pageConfig, baseUrl, projectId);
      process.stdout.write(`Auditing ${pageConfig.id}: ${url}\n`);
      try {
        const lhr = await auditPage(chrome, pageConfig, url, options.verbose);
        await writePageReports(outputDir, pageConfig.id, lhr);
        const summary = createPageSummary(pageConfig, url, lhr);
        summaries.push(summary);
        process.stdout.write(
          `  ${Math.round(summary.score * 100)} (minimum ${Math.round(summary.minimumScore * 100)}) ${summary.passed ? "PASS" : "FAIL"}\n`,
        );
      } catch (error) {
        summaries.push({
          id: pageConfig.id,
          title: pageConfig.title,
          url,
          minimumScore: pageConfig.minimumScore,
          passed: false,
          audits: [],
          error: `${error?.stack ?? error}`,
        });
        process.stderr.write(`  ERROR: ${error?.message ?? error}\n`);
      }
    }
  } finally {
    await stopChromium(chrome, options.keepProfile);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    baseUrl,
    config: basename(configPath),
    pages: summaries,
  };
  await writeFile(
    join(outputDir, "summary.json"),
    `${JSON.stringify(summary, null, 2)}\n`,
  );
  await writeFile(
    join(outputDir, "summary.md"),
    renderMarkdownSummary(summary),
  );

  const failures = summaries.filter(({ passed }) => !passed);
  process.stdout.write(
    `Summary: ${summaries.length - failures.length}/${summaries.length} passed\n`,
  );
  if (failures.length > 0 && options.failOnThreshold) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  process.stderr.write(`${error?.stack ?? error}\n`);
  process.exitCode = 1;
});
