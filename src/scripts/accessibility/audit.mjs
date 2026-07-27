#!/usr/bin/env node

import { spawn, execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createRequire } from "node:module";

import lighthouse, { desktopConfig, generateReport } from "lighthouse";

import {
  createAxeSummary,
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
  const continueImpersonation = page.getByRole("button", {
    exact: true,
    name: "Continue impersonation",
  });
  if (
    await continueImpersonation.isVisible({ timeout: 5000 }).catch(() => false)
  ) {
    await continueImpersonation.click();
    await page.waitForURL(
      (url) => !url.pathname.startsWith("/auth/impersonate"),
      { timeout: 60_000 },
    );
  }
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
  if (
    pageConfig.authentication !== "none" &&
    new URL(page.url()).pathname === "/"
  ) {
    throw new Error(
      `authenticated route redirected to the landing page: ${url}`,
    );
  }
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

function actionLocator(page, action) {
  if (action.selector) {
    return page.locator(action.selector).first();
  }
  if (action.role) {
    const name =
      action.nameRegex != null
        ? new RegExp(action.nameRegex, action.nameRegexFlags)
        : action.name;
    return page.getByRole(action.role, {
      exact: action.exact ?? action.nameRegex == null,
      name,
    });
  }
  if (action.text) {
    return page.getByText(action.text, { exact: action.exact ?? true });
  }
  throw new Error(
    `${action.type} action needs selector, role, or text targeting`,
  );
}

async function runScenarioActions(page, actions, remembered) {
  for (const action of actions ?? []) {
    const timeout = action.timeoutMs ?? 30_000;
    switch (action.type) {
      case "assertFocus": {
        const element = remembered.get(action.key);
        if (!element) {
          throw new Error(`no remembered element named ${action.key}`);
        }
        const focused = await element.evaluate(
          (node) => document.activeElement === node,
        );
        if (!focused) {
          throw new Error(
            `expected focus to return to remembered element ${action.key}`,
          );
        }
        break;
      }
      case "assertFocusWithin": {
        const locator = actionLocator(page, action);
        await locator.waitFor({ state: "visible", timeout });
        const focused = await locator.evaluate(
          (node) =>
            document.activeElement === node ||
            node.contains(document.activeElement),
        );
        if (!focused) {
          throw new Error(`expected focus within ${locator}`);
        }
        break;
      }
      case "assertHidden":
        await actionLocator(page, action).waitFor({
          state: "hidden",
          timeout,
        });
        break;
      case "click":
        await actionLocator(page, action).click({ timeout });
        break;
      case "focus":
        await actionLocator(page, action).focus({ timeout });
        break;
      case "press":
        if (action.selector || action.role || action.text) {
          await actionLocator(page, action).press(action.key, { timeout });
        } else {
          await page.keyboard.press(action.key);
        }
        break;
      case "remember": {
        const locator = actionLocator(page, action);
        await locator.waitFor({ state: "visible", timeout });
        const element = await locator.elementHandle();
        if (!element) {
          throw new Error(`unable to remember element ${action.key}`);
        }
        remembered.set(action.key, element);
        break;
      }
      case "wait":
        await actionLocator(page, action).waitFor({
          state: action.state ?? "visible",
          timeout,
        });
        break;
      case "waitForTimeout":
        await page.waitForTimeout(action.timeoutMs ?? 250);
        break;
      default:
        throw new Error(`unsupported scenario action: ${action.type}`);
    }
  }
}

async function loadAxeSource() {
  const require = createRequire(import.meta.url);
  const entry = require.resolve("axe-core/axe.min.js", {
    paths: [SRC_ROOT],
  });
  return await readFile(entry, "utf8");
}

async function auditScenario(page, pageConfig, url, axeSource) {
  await warmPage(page, pageConfig, url);
  const remembered = new Map();
  await runScenarioActions(page, pageConfig.actions, remembered);
  try {
    await page.addScriptTag({ content: axeSource });
    const result = await page.evaluate(async () => {
      return await globalThis.axe.run(document, {
        resultTypes: ["violations", "incomplete", "passes", "inapplicable"],
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"],
        },
      });
    });
    for (const violation of result.violations ?? []) {
      for (const node of violation.nodes ?? []) {
        const selector = node.target?.[0];
        if (typeof selector !== "string") continue;
        node.debug = await page
          .locator(selector)
          .first()
          .evaluate((element) => ({
            accessibleText: element.textContent,
            outerHTML: element.outerHTML,
          }))
          .catch(() => undefined);
      }
    }
    return result;
  } finally {
    await runScenarioActions(page, pageConfig.cleanupActions, remembered).catch(
      (error) => {
        throw new Error(`scenario cleanup failed: ${error.message}`, {
          cause: error,
        });
      },
    );
    for (const element of remembered.values()) {
      await element.dispose();
    }
  }
}

function safeId(value) {
  return value.replace(/[^a-zA-Z0-9_-]+/g, "-");
}

async function writePageReports(outputDir, pageId, lhr) {
  const prefix = join(outputDir, safeId(pageId));
  await writeFile(`${prefix}.json`, `${JSON.stringify(lhr, null, 2)}\n`);
  await writeFile(`${prefix}.html`, generateReport(lhr, "html"));
}

function escapeHtml(value) {
  return `${value ?? ""}`
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderAxeReport(pageConfig, url, result) {
  const violations = result.violations ?? [];
  const violationHtml =
    violations.length === 0
      ? '<p class="pass">No WCAG 2.x violations detected.</p>'
      : violations
          .map(
            (violation) => `<section>
  <h2>${escapeHtml(violation.help)} <code>${escapeHtml(violation.id)}</code></h2>
  <p><strong>Impact:</strong> ${escapeHtml(violation.impact ?? "unknown")}</p>
  <p>${escapeHtml(violation.description)}</p>
  <p><a href="${escapeHtml(violation.helpUrl)}">Rule documentation</a></p>
  ${(violation.nodes ?? [])
    .map(
      (node) => `<article>
    <h3>${escapeHtml(node.target?.join(", "))}</h3>
    <pre>${escapeHtml(node.html)}</pre>
    <pre>${escapeHtml(node.failureSummary)}</pre>
  </article>`,
    )
    .join("\n")}
</section>`,
          )
          .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(pageConfig.title)} accessibility report</title>
  <style>
    body { color: #1f2937; font: 16px/1.5 sans-serif; margin: 0 auto; max-width: 1100px; padding: 2rem; }
    a { color: #075985; }
    article, section { border-top: 1px solid #d1d5db; margin-top: 1.5rem; padding-top: 1rem; }
    code, pre { background: #f3f4f6; border-radius: 4px; overflow-wrap: anywhere; padding: .25rem; white-space: pre-wrap; }
    .pass { background: #dcfce7; border: 1px solid #16a34a; padding: 1rem; }
  </style>
</head>
<body>
  <h1>${escapeHtml(pageConfig.title)}</h1>
  <p><a href="${escapeHtml(url)}">${escapeHtml(url)}</a></p>
  <p>${violations.length} violations, ${result.incomplete?.length ?? 0} incomplete checks, ${result.passes?.length ?? 0} passing rules.</p>
  ${violationHtml}
</body>
</html>
`;
}

async function writeAxeReports(outputDir, pageConfig, url, result) {
  const prefix = join(outputDir, safeId(pageConfig.id));
  await writeFile(`${prefix}.json`, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(`${prefix}.html`, renderAxeReport(pageConfig, url, result));
}

async function writeFailureDiagnostics(outputDir, pageConfig, page) {
  const prefix = join(outputDir, `${safeId(pageConfig.id)}-error`);
  await page
    .screenshot({ fullPage: true, path: `${prefix}.png` })
    .catch(() => undefined);
  const diagnostic = {
    bodyText: await page
      .locator("body")
      .innerText({ timeout: 2000 })
      .catch(() => undefined),
    title: await page.title().catch(() => undefined),
    url: page.url(),
  };
  await writeFile(`${prefix}.json`, `${JSON.stringify(diagnostic, null, 2)}\n`);
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
  const axeSource = pages.some(({ engine }) => engine === "axe")
    ? await loadAxeSource()
    : undefined;
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
        let summary;
        if (pageConfig.engine === "axe") {
          const result = await auditScenario(
            chrome.page,
            pageConfig,
            url,
            axeSource,
          );
          await writeAxeReports(outputDir, pageConfig, url, result);
          summary = createAxeSummary(pageConfig, url, result);
        } else {
          const lhr = await auditPage(chrome, pageConfig, url, options.verbose);
          await writePageReports(outputDir, pageConfig.id, lhr);
          summary = createPageSummary(pageConfig, url, lhr);
        }
        summaries.push(summary);
        const result =
          summary.engine === "axe"
            ? `${summary.violationCount} violations`
            : `${Math.round(summary.score * 100)} (minimum ${Math.round(summary.minimumScore * 100)})`;
        process.stdout.write(
          `  ${result} ${summary.passed ? "PASS" : "FAIL"}\n`,
        );
      } catch (error) {
        await writeFailureDiagnostics(outputDir, pageConfig, chrome.page).catch(
          () => undefined,
        );
        summaries.push({
          engine: pageConfig.engine,
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
