#!/usr/bin/env node

/*
 * This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 * License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const scriptDir = dirname(fileURLToPath(import.meta.url));
const cli = resolve(scriptDir, "../../cli/dist/bin/cocalc.js");
const MARKER_KIND = "cocalc-project-start-staging-load-v1";
const MARKER_PATH = "/home/user/.cocalc-project-start-staging-load.json";
const DATA_PREFIX = "/home/user/.cocalc-project-start-staging-load-";
const MODES = new Set(["cpu", "buffered-io", "direct-io", "cleanup"]);

function parseArgs(argv) {
  const options = {
    api: "https://staging.cocalc.ai",
    duration_s: 1_800,
    state: `/tmp/project-start-load-${Date.now()}.json`,
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
  options.duration_s = Number(options.duration_s);
  if (options.api !== "https://staging.cocalc.ai") {
    throw new Error("this load driver is intentionally staging-only");
  }
  if (!MODES.has(options.mode)) {
    throw new Error(`--mode must be one of ${Array.from(MODES).join(", ")}`);
  }
  if (
    options.projects.length < 1 ||
    options.projects.length > 32 ||
    options.projects.some((id) => !UUID_RE.test(id))
  ) {
    throw new Error("--projects must contain 1 through 32 project UUIDs");
  }
  if (
    !Number.isInteger(options.duration_s) ||
    options.duration_s < 30 ||
    options.duration_s > 7_200
  ) {
    throw new Error("--duration-s must be an integer from 30 through 7200");
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

function cleanupCommand() {
  return `python3 - <<'PY'
import glob, json, os, signal, time

marker_path = ${JSON.stringify(MARKER_PATH)}
marker_kind = ${JSON.stringify(MARKER_KIND)}
data_prefix = ${JSON.stringify(DATA_PREFIX)}

owned = {}

try:
    with open(marker_path, "r", encoding="utf-8") as f:
        marker = json.load(f)
except (FileNotFoundError, json.JSONDecodeError, OSError):
    marker = None

if marker and marker.get("kind") == marker_kind:
    pid = int(marker.get("pid", 0))
    token = str(marker.get("token", ""))
    if pid > 1 and token:
        owned[pid] = token

# A newer load must not make an older tagged process unreachable merely by
# replacing the marker. The dedicated environment key is set only by this
# staging harness, so discover every surviving owned process before cleanup.
for environ_path in glob.glob("/proc/[0-9]*/environ"):
    try:
        pid = int(environ_path.split("/")[2])
        environ = open(environ_path, "rb").read().split(b"\\0")
    except (OSError, ValueError):
        continue
    prefix = b"COCALC_P95_LOAD_TOKEN="
    token_entry = next((entry for entry in environ if entry.startswith(prefix)), None)
    if token_entry is not None:
        token = token_entry[len(prefix):].decode("utf-8", errors="ignore")
        if pid > 1 and token:
            owned[pid] = token

for pid, token in owned.items():
    try:
        environ = open(f"/proc/{pid}/environ", "rb").read()
    except OSError:
        environ = b""
    is_owned = bool(token) and f"COCALC_P95_LOAD_TOKEN={token}".encode() in environ
    if is_owned:
        try:
            os.kill(pid, signal.SIGTERM)
        except ProcessLookupError:
            pass

deadline = time.monotonic() + 5
for pid, token in owned.items():
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            break
        time.sleep(0.1)
    else:
        try:
            os.kill(pid, signal.SIGKILL)
        except ProcessLookupError:
            pass

for path in [marker_path, *glob.glob(f"{data_prefix}*.bin")]:
    try:
        os.unlink(path)
    except FileNotFoundError:
        pass
PY`;
}

function loadCommand({ mode, duration_s, token }) {
  return `COCALC_P95_LOAD_TOKEN=${token} python3 - <<'PY'
import json, mmap, os, signal, time

kind = ${JSON.stringify(MARKER_KIND)}
marker_path = ${JSON.stringify(MARKER_PATH)}
mode = ${JSON.stringify(mode)}
token = ${JSON.stringify(token)}
duration_s = ${duration_s}
data_path = ${JSON.stringify(DATA_PREFIX)} + mode + ".bin"
stop = False

def request_stop(_signum, _frame):
    global stop
    stop = True

signal.signal(signal.SIGTERM, request_stop)
signal.signal(signal.SIGINT, request_stop)
started = time.time()
with open(marker_path, "w", encoding="utf-8") as f:
    json.dump({
        "kind": kind,
        "token": token,
        "mode": mode,
        "pid": os.getpid(),
        "started_at": started,
        "expires_at": started + duration_s,
        "data_path": data_path if mode != "cpu" else None,
    }, f)

fd = None
buf = None
try:
    deadline = time.monotonic() + duration_s
    if mode == "cpu":
        value = 1
        while not stop and time.monotonic() < deadline:
            value = (value * 1103515245 + 12345) & 0x7fffffff
    elif mode == "buffered-io":
        fd = os.open(data_path, os.O_CREAT | os.O_RDWR, 0o600)
        size = 256 * 1024 * 1024
        block = b"b" * (1024 * 1024)
        os.ftruncate(fd, size)
        offset = 0
        writes_since_sync = 0
        while not stop and time.monotonic() < deadline:
            os.pwrite(fd, block, offset)
            offset = (offset + len(block)) % size
            writes_since_sync += 1
            if writes_since_sync == 4:
                os.fdatasync(fd)
                writes_since_sync = 0
    elif mode == "direct-io":
        fd = os.open(data_path, os.O_CREAT | os.O_RDWR | os.O_DIRECT, 0o600)
        size = 256 * 1024 * 1024
        os.ftruncate(fd, size)
        buf = mmap.mmap(-1, 4096)
        buf[:] = b"d" * 4096
        slot = 1
        slots = size // 4096
        while not stop and time.monotonic() < deadline:
            slot = (slot * 1103515245 + 12345) % slots
            os.pwrite(fd, buf, slot * 4096)
finally:
    if buf is not None:
        buf.close()
    if fd is not None:
        os.close(fd)
    for path in (marker_path, data_path):
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
PY`;
}

const options = parseArgs(process.argv.slice(2));
const results = [];
for (const project_id of options.projects) {
  if (options.mode === "cleanup") {
    const response = await runCli(options.api, [
      "project",
      "exec",
      "-w",
      project_id,
      "--bash",
      cleanupCommand(),
    ]);
    results.push({ project_id, cleaned: response.data?.exit_code === 0 });
    continue;
  }
  await runCli(options.api, [
    "project",
    "exec",
    "-w",
    project_id,
    "--bash",
    cleanupCommand(),
  ]);
  const token = randomUUID();
  const response = await runCli(options.api, [
    "project",
    "exec",
    "-w",
    project_id,
    "--timeout",
    `${options.duration_s + 30}`,
    "--async",
    "--bash",
    loadCommand({
      mode: options.mode,
      duration_s: options.duration_s,
      token,
    }),
  ]);
  results.push({
    project_id,
    mode: options.mode,
    duration_s: options.duration_s,
    token,
    job_id: response.data?.job_id,
    pid: response.data?.pid,
  });
}

const state = {
  schema: MARKER_KIND,
  api: options.api,
  mode: options.mode,
  created_at: new Date().toISOString(),
  duration_s: options.mode === "cleanup" ? undefined : options.duration_s,
  results,
};
await writeFile(options.state, `${JSON.stringify(state, null, 2)}\n`, "utf8");
process.stdout.write(
  `${JSON.stringify({ ...state, state: options.state }, null, 2)}\n`,
);
