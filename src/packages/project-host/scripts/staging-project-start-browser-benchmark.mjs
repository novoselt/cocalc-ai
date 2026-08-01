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

async function runCli(api, args) {
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

try {
  for (let round = 1; round <= options.rounds; round += 1) {
    for (const projectId of options.projects) {
      await runCli(options.api, ["project", "stop", "-w", projectId, "--wait"]);
      // Establish the qualified cohort with one foreground page whose initial
      // state already reflects the stopped project. External stop propagation
      // and background-tab throttling are measured separately.
      await page.goto(`${options.api}/projects/${projectId}/files/`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.bringToFront();
      const startButton = page.getByTitle("Start Project");
      await startButton.waitFor({ state: "visible", timeout: 30_000 });
      await sleep(options.settle_ms);
      const requestedAtMs = Date.now();
      const started = performance.now();
      await startButton.click();
      const starting = page.getByText("Starting", { exact: true });
      await starting.waitFor({ state: "visible", timeout: 5_000 });
      await starting.waitFor({ state: "hidden", timeout: 30_000 });
      const browserElapsedMs = Math.round(performance.now() - started);
      const failed = await startButton.isVisible();
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
          Date.parse(candidate.created_at) >= requestedAtMs - 2_000,
      );
      if (operation == null) {
        throw new Error(`could not correlate browser start for ${projectId}`);
      }
      const phaseTimings = operation.result?.phase_timings_ms ?? {};
      const sample = {
        scenario: options.scenario,
        round,
        project_id: projectId,
        op_id: operation.op_id,
        requested_at: new Date(requestedAtMs).toISOString(),
        browser_elapsed_ms: browserElapsedMs,
        browser_failed: failed,
        operation_created_at: operation.created_at,
        operation_finished_at: operation.finished_at,
        request_dispatch_ms: Date.parse(operation.created_at) - requestedAtMs,
        observation_lag_ms:
          browserElapsedMs - Number(phaseTimings["control.total"] ?? 0),
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
    },
    null,
    2,
  )}\n`,
);
