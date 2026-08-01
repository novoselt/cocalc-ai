#!/usr/bin/env node

import { spawn } from "node:child_process";
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const cli = resolve(scriptDir, "../../cli/dist/bin/cocalc.js");
const require = createRequire(import.meta.url);
const { chromium } = require(
  resolve(scriptDir, "../../cli/node_modules/playwright-core"),
);

function parseArgs(argv) {
  const options = {
    api: "https://staging.cocalc.ai",
    chromium: "/usr/bin/chromium",
    rounds: 25,
    scenario: "browser-idle",
    settle_ms: 500,
  };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (!key?.startsWith("--") || value == null) {
      throw new Error(`invalid argument '${key}'`);
    }
    options[key.slice(2).replaceAll("-", "_")] = value;
  }
  options.projects = `${options.projects ?? ""}`
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  options.rounds = Number(options.rounds);
  options.settle_ms = Number(options.settle_ms);
  options.output ||= `/tmp/project-start-${options.scenario}-${Date.now()}.jsonl`;
  if (options.api !== "https://staging.cocalc.ai") {
    throw new Error("this browser benchmark is intentionally staging-only");
  }
  if (
    !options.projects.length ||
    options.projects.some((id) => !UUID_RE.test(id))
  ) {
    throw new Error(
      "--projects must be a comma-separated list of project UUIDs",
    );
  }
  if (
    !Number.isInteger(options.rounds) ||
    options.rounds < 1 ||
    options.rounds > 100
  ) {
    throw new Error("--rounds must be an integer from 1 through 100");
  }
  if (
    !Number.isInteger(options.settle_ms) ||
    options.settle_ms < 0 ||
    options.settle_ms > 30_000
  ) {
    throw new Error("--settle-ms must be an integer from 0 through 30000");
  }
  return options;
}

async function runCliOnce(api, args) {
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(
      process.execPath,
      [
        cli,
        "--profile",
        "staging",
        "--api",
        api,
        "--rpc-timeout",
        "120s",
        "--poll-ms",
        "100ms",
        "--json",
        ...args,
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => (stdout += chunk));
    child.stderr.on("data", (chunk) => (stderr += chunk));
    child.on("error", reject);
    child.on("close", (code) => {
      let response;
      try {
        response = JSON.parse(stdout);
      } catch (err) {
        reject(
          new Error(
            `CLI returned invalid JSON (exit=${code}): ${stderr || stdout}\n${err}`,
          ),
        );
        return;
      }
      if (code !== 0 || !response.ok) {
        reject(
          new Error(
            `CLI failed (exit=${code}): ${JSON.stringify(response.error ?? response)} ${stderr}`,
          ),
        );
        return;
      }
      resolvePromise(response);
    });
  });
}

function isTransientCliFailure(err) {
  return /(?:socket has been disconnected|\bdisconnected\b|ECONNRESET|ECONNREFUSED|no responders|no subscribers|\b503\b|timed? out|timeout)/i.test(
    `${err}`,
  );
}

async function runCli(api, args) {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      return await runCliOnce(api, args);
    } catch (err) {
      lastError = err;
      if (!isTransientCliFailure(err) || attempt === 5) throw err;
      const delayMs = 250 * 2 ** (attempt - 1);
      process.stderr.write(
        `transient CLI failure; retrying in ${delayMs}ms (${attempt}/5): ${err}\n`,
      );
      await sleep(delayMs);
    }
  }
  throw lastError;
}

async function ensureProjectStopped(api, projectId) {
  const deadline = Date.now() + 180_000;
  let lastState = "unknown";
  while (Date.now() < deadline) {
    const before = await runCli(api, ["project", "status", "-w", projectId]);
    lastState = `${before.data?.state ?? "unknown"}`;
    if (!new Set(["running", "starting", "stopping"]).has(lastState)) {
      return;
    }
    try {
      await runCliOnce(api, ["project", "stop", "-w", projectId, "--wait"]);
    } catch (err) {
      if (!isTransientCliFailure(err)) throw err;
      process.stderr.write(
        `project stop response was transient; polling authoritative state: ${err}\n`,
      );
    }
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const status = await runCli(api, ["project", "status", "-w", projectId]);
      lastState = `${status.data?.state ?? "unknown"}`;
      if (!new Set(["running", "starting", "stopping"]).has(lastState)) {
        return;
      }
      await sleep(500);
    }
  }
  throw new Error(
    `project ${projectId} did not stop during benchmark setup (state=${lastState})`,
  );
}

async function waitForStoppedProjectPage(page, url) {
  const deadline = Date.now() + 120_000;
  const startButton = page.getByTitle("Start Project");
  while (Date.now() < deadline) {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.bringToFront();
    try {
      await startButton.waitFor({ state: "visible", timeout: 10_000 });
      return startButton;
    } catch (err) {
      if (Date.now() >= deadline) throw err;
      await sleep(1_000);
    }
  }
  throw new Error(`stopped project page did not become visible: ${url}`);
}

function percentile(values, fraction) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.ceil(sorted.length * fraction) - 1];
}

function distribution(values) {
  const finite = values.filter(Number.isFinite);
  return {
    p50: percentile(finite, 0.5),
    p90: percentile(finite, 0.9),
    p95: percentile(finite, 0.95),
    p99: percentile(finite, 0.99),
    max: finite.length ? Math.max(...finite) : null,
  };
}

function parseCookieHeader(header) {
  return `${header ?? ""}`
    .split(/;\s*/)
    .filter(Boolean)
    .map((entry) => {
      const split = entry.indexOf("=");
      if (split <= 0) throw new Error("invalid staging cookie configuration");
      return {
        name: entry.slice(0, split),
        value: entry.slice(split + 1),
        domain: "staging.cocalc.ai",
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "Lax",
      };
    });
}

async function sleep(ms) {
  await new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

const options = parseArgs(process.argv.slice(2));
const config = JSON.parse(
  await readFile(
    resolve(process.env.HOME, ".config/cocalc/config.json"),
    "utf8",
  ),
);
const cookies = parseCookieHeader(config.profiles?.staging?.cookie);
if (!cookies.length) throw new Error("staging profile has no browser cookie");
await writeFile(options.output, "", "utf8");

const browser = await chromium.launch({
  executablePath: options.chromium,
  headless: true,
});
const context = await browser.newContext();
await context.addCookies(cookies);
const page = await context.newPage();
const samples = [];
let browserConsole = [];
page.on("console", (message) => {
  if (message.type() !== "warning" && message.type() !== "error") return;
  browserConsole.push({
    at: new Date().toISOString(),
    type: message.type(),
    text: message.text().slice(0, 2_000),
  });
  if (browserConsole.length > 100) browserConsole.shift();
});

try {
  for (let round = 1; round <= options.rounds; round += 1) {
    for (const projectId of options.projects) {
      await ensureProjectStopped(options.api, projectId);
      // Establish the qualified cohort with one foreground page whose initial
      // state already reflects the stopped project. The apps route exposes the
      // title-bar Start control without implicitly autostarting a stopped
      // project, unlike a file route. External stop propagation and
      // background-tab throttling are measured separately.
      const startButton = await waitForStoppedProjectPage(
        page,
        `${options.api}/projects/${projectId}/apps`,
      );
      // Navigation preserves the synthetic pointer position. Move it away
      // from the toolbar so a tooltip from the prior project cannot intercept
      // the next real user-path click.
      await page.mouse.move(0, 0);
      await sleep(options.settle_ms);
      const priorOperations = await runCli(options.api, [
        "op",
        "list",
        "--scope-type",
        "project",
        "--scope-id",
        projectId,
        "--include-completed",
        "--limit",
        "5",
      ]);
      const priorOperationIds = new Set(
        priorOperations.data.map((operation) => operation.op_id),
      );
      browserConsole = [];
      await page.evaluate(() => {
        const state = globalThis.__cocalcProjectStartBenchmark;
        state?.observer?.disconnect();
        const transitions = [];
        const snapshot = () => {
          const start = document.querySelector('[title="Start Project"]');
          const starting = document.querySelector(
            '[title="Project is starting"]',
          );
          const next = {
            at_ms: Date.now(),
            start_visible: !!start?.clientHeight,
            starting_visible: !!starting?.clientHeight,
          };
          const previous = transitions.at(-1);
          if (
            previous?.start_visible === next.start_visible &&
            previous?.starting_visible === next.starting_visible
          ) {
            return;
          }
          transitions.push(next);
        };
        const observer = new MutationObserver(snapshot);
        observer.observe(document.body, {
          attributes: true,
          childList: true,
          subtree: true,
        });
        globalThis.__cocalcProjectStartBenchmark = { observer, transitions };
        snapshot();
      });
      const requestedAtMs = Date.now();
      const started = performance.now();
      const startingButton = page.getByTitle("Project is starting");
      // Arm the transition observer before dispatch so a fast optimistic
      // render cannot occur between the click and waiter registration.
      const startingVisible = startingButton.waitFor({
        state: "visible",
        timeout: 5_000,
      });
      await startButton.click();
      // Measure the browser's authoritative project state rather than a
      // generic text label. The title is the frontend's explicit starting
      // state and remains until the start action accepts terminal state.
      try {
        await startingVisible;
        await startingButton.waitFor({ state: "hidden", timeout: 30_000 });
      } catch (err) {
        const diagnostic = await page.evaluate(() => {
          return {
            start_button_visible: document.querySelector(
              '[title="Start Project"]',
            )?.clientHeight
              ? true
              : false,
            starting_button_visible: document.querySelector(
              '[title="Project is starting"]',
            )?.clientHeight
              ? true
              : false,
          };
        });
        throw new Error(
          `browser did not observe running state: ${JSON.stringify(diagnostic)}`,
          { cause: err },
        );
      }
      const browserWaiterElapsedMs = Math.round(performance.now() - started);
      const failed = await startButton.isVisible();
      const browserStateTransitions = await page.evaluate(() => {
        const state = globalThis.__cocalcProjectStartBenchmark;
        state?.observer?.disconnect();
        return state?.transitions ?? [];
      });
      const runningTransition = browserStateTransitions.findLast(
        (transition) =>
          !transition.start_visible && !transition.starting_visible,
      );
      const browserObservedAtMs =
        runningTransition?.at_ms ?? requestedAtMs + browserWaiterElapsedMs;
      const browserElapsedMs = Math.max(0, browserObservedAtMs - requestedAtMs);
      const operations = await runCli(options.api, [
        "op",
        "list",
        "--scope-type",
        "project",
        "--scope-id",
        projectId,
        "--include-completed",
        "--limit",
        "5",
      ]);
      const operation = operations.data.find(
        (candidate) =>
          candidate.kind === "project-start" &&
          !priorOperationIds.has(candidate.op_id) &&
          Date.parse(candidate.created_at) >= requestedAtMs - 2_000,
      );
      if (operation == null) {
        throw new Error(`could not correlate browser start for ${projectId}`);
      }
      const phaseTimings = operation.result?.phase_timings_ms ?? {};
      const requestDispatchMs =
        Date.parse(operation.created_at) - requestedAtMs;
      const backendElapsedMs = Number(phaseTimings["control.total"] ?? 0);
      const sample = {
        scenario: options.scenario,
        round,
        project_id: projectId,
        op_id: operation.op_id,
        requested_at: new Date(requestedAtMs).toISOString(),
        browser_elapsed_ms: browserElapsedMs,
        browser_waiter_elapsed_ms: browserWaiterElapsedMs,
        browser_failed: failed,
        browser_state_transitions: browserStateTransitions,
        browser_console: [...browserConsole],
        operation_created_at: operation.created_at,
        operation_finished_at: operation.finished_at,
        request_dispatch_ms: requestDispatchMs,
        // Retain the original aggregate for comparison with earlier runs.
        observation_lag_ms: browserElapsedMs - backendElapsedMs,
        post_backend_observation_ms:
          browserElapsedMs - requestDispatchMs - backendElapsedMs,
        authoritative_state_observation_ms:
          browserObservedAtMs - Date.parse(operation.finished_at),
        phase_timings_ms: phaseTimings,
      };
      samples.push(sample);
      await appendFile(options.output, `${JSON.stringify(sample)}\n`, "utf8");
      if (failed) throw new Error(`browser start failed for ${projectId}`);
    }
    process.stderr.write(
      `completed ${round}/${options.rounds} rounds (${samples.length} samples)\n`,
    );
  }
} finally {
  await browser.close();
}

process.stdout.write(
  `${JSON.stringify(
    {
      scenario: options.scenario,
      output: resolve(options.output),
      samples: samples.length,
      failures: samples.filter((sample) => sample.browser_failed).length,
      browser_ms: distribution(
        samples.map((sample) => sample.browser_elapsed_ms),
      ),
      backend_ms: distribution(
        samples.map((sample) => sample.phase_timings_ms["control.total"]),
      ),
      observation_lag_ms: distribution(
        samples.map((sample) => sample.observation_lag_ms),
      ),
      request_dispatch_ms: distribution(
        samples.map((sample) => sample.request_dispatch_ms),
      ),
      post_backend_observation_ms: distribution(
        samples.map((sample) => sample.post_backend_observation_ms),
      ),
      authoritative_state_observation_ms: distribution(
        samples.map((sample) => sample.authoritative_state_observation_ms),
      ),
      browser_waiter_ms: distribution(
        samples.map((sample) => sample.browser_waiter_elapsed_ms),
      ),
    },
    null,
    2,
  )}\n`,
);
