#!/usr/bin/env node
/*
 * Drive retention-critical CoCalc workflows through a signed-in Chromium tab.
 * This is intentionally a thin plan generator around `cocalc browser harness`.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const srcRoot = resolve(scriptDir, "../..");
const cli = resolve(srcRoot, "packages/cli/dist/bin/cocalc.js");

function usage(exitCode = 0) {
  console.log(`Usage:
  node src/scripts/ops/run-ux-latency-harness.mjs \\
    --api https://staging.cocalc.ai --profile staging \\
    --project <uuid> [--browser <id>] [--iterations 3] [--include-codex]

The target browser must already be signed in and connected. The harness creates
small fixtures under /home/user/.cocalc-ux-harness, drives a hard refresh,
directory listing, text file, Jupyter, LaTeX, upload, terminal, and optionally a
real Codex turn, then writes the ordinary browser-harness report.
`);
  process.exit(exitCode);
}

function parseArgs(argv) {
  const options = {
    iterations: 1,
    includeCodex: false,
    reportDir: undefined,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (!next) throw Error(`${arg} requires a value`);
      return next;
    };
    if (arg === "--api") options.api = value();
    else if (arg === "--profile") options.profile = value();
    else if (arg === "--project") options.project = value();
    else if (arg === "--browser") options.browser = value();
    else if (arg === "--iterations") options.iterations = Number(value());
    else if (arg === "--report-dir") options.reportDir = value();
    else if (arg === "--include-codex") options.includeCodex = true;
    else if (arg === "--help" || arg === "-h") usage();
    else throw Error(`unknown option '${arg}'`);
  }
  options.api ??= process.env.COCALC_SITE_URL;
  options.project ??= process.env.COCALC_PROJECT_ID;
  options.browser ??= process.env.COCALC_BROWSER_ID;
  if (!options.api) throw Error("--api or COCALC_SITE_URL is required");
  if (!options.project)
    throw Error("--project or COCALC_PROJECT_ID is required");
  if (
    !Number.isInteger(options.iterations) ||
    options.iterations < 1 ||
    options.iterations > 100
  ) {
    throw Error("--iterations must be an integer from 1 through 100");
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const origin = new URL(options.api).origin;
const runId = `ux-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const reportDir = resolve(
  options.reportDir ?? `.cocalc-browser-harness/${runId}`,
);
const fixtureDir = mkdtempSync(join(tmpdir(), "cocalc-ux-harness-"));
const remoteRoot = "/home/user/.cocalc-ux-harness";

const globalArgs = [];
if (options.profile) globalArgs.push("--profile", options.profile);
globalArgs.push("--api", options.api);

function run(args, { capture = false } = {}) {
  const result = spawnSync(process.execPath, [cli, ...globalArgs, ...args], {
    encoding: "utf8",
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
    env: process.env,
  });
  if (result.status !== 0) {
    const detail = capture ? `\n${result.stderr || result.stdout}` : "";
    throw Error(`cocalc ${args.join(" ")} failed${detail}`);
  }
  return capture ? result.stdout : "";
}

function remoteUrl(path = "") {
  const relative = `${remoteRoot}/${path}`
    .replace(/^\/home\/user\/?/, "")
    .split("/")
    .map(encodeURIComponent)
    .join("/");
  return `${origin}/projects/${options.project}/files/home/user/${relative}`;
}

function waitForText(name, includes, timeout_ms = 45_000) {
  return {
    name,
    action: { name: "wait_for_text", includes, timeout_ms, poll_ms: 100 },
  };
}

function navigate(name, path) {
  return {
    name,
    action: { name: "navigate", url: remoteUrl(path), wait_for_url_ms: 20_000 },
  };
}

function createFixtures() {
  mkdirSync(fixtureDir, { recursive: true });
  writeFileSync(
    join(fixtureDir, "visible.md"),
    `# UX latency harness\n\nVisible marker ${runId}\n`,
  );
  writeFileSync(
    join(fixtureDir, "notebook.ipynb"),
    JSON.stringify({
      cells: [
        {
          cell_type: "code",
          execution_count: null,
          id: "ux-harness-cell",
          metadata: {},
          outputs: [],
          source: [`print(\"JUPYTER_${runId}\")`],
        },
      ],
      metadata: {
        kernelspec: {
          display_name: "Python 3",
          language: "python",
          name: "python3",
        },
        language_info: { name: "python", version: "3" },
      },
      nbformat: 4,
      nbformat_minor: 5,
    }),
  );
  writeFileSync(
    join(fixtureDir, "document.tex"),
    `\\documentclass{article}\n\\begin{document}\nLaTeX ${runId}\n\\end{document}\n`,
  );
  writeFileSync(join(fixtureDir, "terminal.term"), "");
  run(["project", "file", "mkdir", "-w", options.project, remoteRoot]);
  for (const name of [
    "visible.md",
    "notebook.ipynb",
    "document.tex",
    "terminal.term",
  ]) {
    run([
      "project",
      "file",
      "put",
      "-w",
      options.project,
      join(fixtureDir, name),
      `${remoteRoot}/${name}`,
    ]);
  }
}

function iterationSteps(iteration) {
  const prefix = `iteration ${iteration}`;
  const uploadName = `uploaded-${runId}-${iteration}.txt`;
  const uploadContent = Buffer.from(
    `Upload marker ${runId} iteration ${iteration}\n`,
  ).toString("base64");
  const steps = [
    navigate(`${prefix}: open directory`, ""),
    waitForText(`${prefix}: directory listing`, "visible.md"),
    navigate(`${prefix}: open text file`, "visible.md"),
    waitForText(`${prefix}: text visible`, `Visible marker ${runId}`),
    navigate(`${prefix}: open Jupyter`, "notebook.ipynb"),
    {
      name: `${prefix}: Jupyter editor ready`,
      action: {
        name: "wait_for_selector",
        selector: ".CodeMirror",
        timeout_ms: 60_000,
      },
    },
    {
      name: `${prefix}: focus Jupyter cell`,
      action: { name: "click", selector: ".CodeMirror", timeout_ms: 30_000 },
    },
    {
      name: `${prefix}: run Jupyter cell`,
      action: { name: "press", key: "Enter", shift: true, timeout_ms: 30_000 },
    },
    waitForText(`${prefix}: Jupyter output`, `JUPYTER_${runId}`, 90_000),
    navigate(`${prefix}: open LaTeX`, "document.tex"),
    {
      name: `${prefix}: LaTeX build ready`,
      action: {
        name: "wait_for_selector",
        selector: "[data-testid='latex-build']",
        timeout_ms: 60_000,
      },
    },
    {
      name: `${prefix}: build LaTeX`,
      action: { name: "click", selector: "[data-testid='latex-build']" },
    },
    { name: `${prefix}: allow LaTeX completion`, sleep_ms: 5_000 },
    navigate(`${prefix}: return to directory for upload`, ""),
    {
      name: `${prefix}: upload input ready`,
      action: {
        name: "wait_for_selector",
        selector: "input[type='file']",
        state: "attached",
        timeout_ms: 30_000,
      },
    },
    {
      name: `${prefix}: upload fixture`,
      action: {
        name: "upload_file",
        selector: "input[type='file']",
        filename: uploadName,
        content_base64: uploadContent,
        mime_type: "text/plain",
      },
    },
    waitForText(`${prefix}: upload visible`, uploadName, 60_000),
    navigate(`${prefix}: open terminal`, "terminal.term"),
    {
      name: `${prefix}: terminal ready`,
      action: {
        name: "wait_for_selector",
        selector: ".xterm-helper-textarea",
        state: "attached",
        timeout_ms: 90_000,
      },
    },
  ];
  if (options.includeCodex) {
    steps.push(
      navigate(`${prefix}: open Codex chat`, `codex-${runId}.chat`),
      {
        name: `${prefix}: Codex composer ready`,
        action: {
          name: "wait_for_selector",
          selector:
            "[data-testid='chat-composer-input'] [data-slate-editor='true']",
          timeout_ms: 60_000,
        },
      },
      {
        name: `${prefix}: enter Codex prompt`,
        action: {
          name: "type",
          selector:
            "[data-testid='chat-composer-input'] [data-slate-editor='true']",
          text: `Reply with the three underscore-separated words UX, HARNESS, and READY followed by ${iteration}.`,
        },
      },
      {
        name: `${prefix}: send Codex prompt`,
        action: {
          name: "click",
          selector: "[data-testid='chat-composer-send']",
        },
      },
      waitForText(
        `${prefix}: Codex first response`,
        `UX_HARNESS_READY ${iteration}`,
        180_000,
      ),
    );
  }
  return steps;
}

try {
  createFixtures();
  const plan = {
    name: `retention UX latency ${runId}`,
    default_retries: 1,
    default_timeout_ms: 60_000,
    default_recovery: "reload",
    default_pause_ms: 150,
    max_failures: 1,
    capture: {
      screenshot_on_fail: true,
      logs_on_fail: 160,
      network_on_fail: 160,
    },
    before_all: [
      navigate("load project before hard refresh", ""),
      {
        name: "hard refresh application",
        action: { name: "reload", hard: true },
        pause_ms: 2_500,
        retries: 2,
      },
      waitForText("application and project ready", "visible.md", 90_000),
    ],
    steps: Array.from({ length: options.iterations }, (_, index) =>
      iterationSteps(index + 1),
    ).flat(),
    after_all: [navigate("finish on harness directory", "")],
  };
  const planPath = join(fixtureDir, "plan.json");
  writeFileSync(planPath, JSON.stringify(plan, null, 2));
  const harnessArgs = [
    "browser",
    "harness",
    "run",
    "--plan",
    planPath,
    "--project-id",
    options.project,
    "--session-project-id",
    options.project,
    "--active-only",
    "--report-dir",
    reportDir,
    "--pin-target",
  ];
  if (options.browser) harnessArgs.push("--browser", options.browser);
  console.log(`ux_harness_run_id=${runId}`);
  console.log(`ux_harness_started_at=${new Date().toISOString()}`);
  console.log(`ux_harness_report_dir=${reportDir}`);
  run(harnessArgs);
  console.log(`ux_harness_finished_at=${new Date().toISOString()}`);
} finally {
  rmSync(fixtureDir, { recursive: true, force: true });
}
