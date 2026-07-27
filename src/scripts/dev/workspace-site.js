#!/usr/bin/env node

const {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} = require("node:fs");
const { spawn, spawnSync } = require("node:child_process");
const { homedir } = require("node:os");
const { dirname, isAbsolute, join, relative, resolve } = require("node:path");
const net = require("node:net");

const SCRIPT_PATH = resolve(__filename);
const SRC_DIR = resolve(__dirname, "..", "..");
const REPO_DIR = resolve(SRC_DIR, "..");
const CONFIG_VERSION = 1;
const SITE_NAME_RE = /^[a-z][a-z0-9-]{0,39}$/;
const DEFAULT_PORT_MIN = 12_000;
const DEFAULT_PORT_MAX = 49_998;
const START_TIMEOUT_MS = 120_000;
const REGISTRY_LOCK_STALE_MS = 60_000;

const GENERATED_BUILD_OUTPUTS = [
  "packages/hub/dist/hub.js",
  "packages/server/dist/launchpad/project-runtime.js",
  "packages/project-runner/dist/run/workspace.js",
  "packages/static/dist/app.html",
  "packages/cli/dist/bin/cocalc.js",
];

const REQUIRED_RUNTIME_FILES = [
  ...GENERATED_BUILD_OUTPUTS,
  "packages/project/bin/cocalc-project.js",
];

const BUILD_SOURCE_PATHS = [
  "packages/backend",
  "packages/cli",
  "packages/conat",
  "packages/database",
  "packages/frontend",
  "packages/hub",
  "packages/launchpad",
  "packages/project",
  "packages/project-runner",
  "packages/server",
  "packages/static",
  "packages/util",
];

function usage() {
  return `Usage: workspace-site.js <command> --name <name> [options]

Commands:
  init       Allocate a named site and generate its private app spec.
  start      Start through the outer project app supervisor, or locally.
  stop       Stop only this named site.
  restart    Stop and start this named site.
  status     Show runtime, source, build, URL, and isolation status.
  logs       Show captured logs; use --follow for a local daemon.
  env        Print shell exports for this site.
  build      Build the source checkout for development.
  hostname   Inspect, --reserve, or --release the private hostname.
  open       Print a short-lived authenticated private-hostname URL.
  serve      Internal foreground Launchpad entrypoint.

Shared options:
  --name <name>          Lowercase site name, unique across worktrees.
  --sites-root <path>    Registry/data root (default: ~/.local/share/cocalc-dev/workspace-sites).
  --json                 Emit machine-readable JSON where applicable.

Init options:
  --port <port>          Reserve an explicit HTTP port and adjacent SSH port.
  --data-dir <path>      Override the persistent data directory.
  --project <id>         Outer CoCalc project ID; enables app supervision.
  --api <url>            CoCalc API/site origin for CLI and ordinary app URL.
  --site-url <url>       Public browser origin when --api is an internal route.
  --profile <name>       CoCalc CLI profile used for app/hostname operations.
  --local                Use a local PID-scoped daemon; outer-project proxying remains available.

Hostname/open options:
  --reserve              Explicitly allocate DNS before inspecting/opening.
  --release              Release DNS and route state.

Log options:
  --tail <lines>         Number of lines (default: 200).
  --follow               Follow the local Launchpad log.
`;
}

function parseArgs(argv) {
  const command = argv[0];
  const opts = {};
  const valueOptions = new Set([
    "name",
    "sites-root",
    "port",
    "data-dir",
    "project",
    "api",
    "site-url",
    "profile",
    "tail",
  ]);
  const flagOptions = new Set([
    "json",
    "local",
    "reserve",
    "release",
    "follow",
    "help",
  ]);
  for (let i = 1; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) {
      throw new Error(`unexpected positional argument '${arg}'`);
    }
    const equals = arg.indexOf("=");
    const key = arg.slice(2, equals === -1 ? undefined : equals);
    if (valueOptions.has(key)) {
      const value = equals === -1 ? argv[++i] : arg.slice(equals + 1);
      if (value == null || value === "") {
        throw new Error(`--${key} requires a value`);
      }
      opts[key.replaceAll("-", "_")] = value;
      continue;
    }
    if (flagOptions.has(key)) {
      if (equals !== -1) {
        throw new Error(`--${key} does not accept a value`);
      }
      opts[key.replaceAll("-", "_")] = true;
      continue;
    }
    throw new Error(`unknown option '--${key}'`);
  }
  return { command, opts };
}

function normalizeSiteName(value) {
  const name = `${value ?? ""}`.trim();
  if (!SITE_NAME_RE.test(name)) {
    throw new Error(
      "site name must start with a lowercase letter and contain at most 40 lowercase letters, digits, or hyphens",
    );
  }
  return name;
}

function normalizeProjectId(value) {
  const projectId = `${value ?? ""}`.trim();
  if (!projectId) return undefined;
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      projectId,
    )
  ) {
    throw new Error(`invalid outer project id '${projectId}'`);
  }
  return projectId;
}

function defaultSitesRoot(env = process.env) {
  const configured = `${env.COCALC_WORKSPACE_SITES_ROOT ?? ""}`.trim();
  if (configured) return resolve(configured);
  const dataHome =
    `${env.XDG_DATA_HOME ?? ""}`.trim() ||
    join(env.HOME ?? homedir(), ".local", "share");
  return resolve(dataHome, "cocalc-dev", "workspace-sites");
}

function sitesRoot(opts, env = process.env) {
  return resolve(opts.sites_root ?? defaultSitesRoot(env));
}

function siteDir(root, name) {
  return join(root, name);
}

function configPath(root, name) {
  return join(siteDir(root, name), "config.json");
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  renameSync(temporary, path);
}

async function withRegistryLock(root, fn) {
  mkdirSync(root, { recursive: true });
  const lockPath = join(root, ".registry.lock");
  let fd;
  try {
    fd = openSync(lockPath, "wx", 0o600);
  } catch (err) {
    if (err?.code === "EEXIST") {
      try {
        const age = Date.now() - statSync(lockPath).mtimeMs;
        if (age > REGISTRY_LOCK_STALE_MS) {
          unlinkSync(lockPath);
          fd = openSync(lockPath, "wx", 0o600);
        }
      } catch {
        // The owner may have released the lock between checks.
      }
    }
    if (fd == null) {
      throw new Error(
        `workspace site registry is busy (${lockPath}); retry shortly`,
      );
    }
  }
  try {
    writeFileSync(fd, `${process.pid}\n`);
    return await fn();
  } finally {
    closeSync(fd);
    try {
      unlinkSync(lockPath);
    } catch {
      // Exact lock cleanup is best effort.
    }
  }
}

function readAllConfigs(root) {
  if (!existsSync(root)) return [];
  const configs = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const path = configPath(root, entry.name);
    if (!existsSync(path)) continue;
    try {
      configs.push(readJson(path));
    } catch {
      // A malformed site is reported when addressed directly.
    }
  }
  return configs;
}

function readConfig(root, name) {
  const path = configPath(root, name);
  if (!existsSync(path)) {
    throw new Error(
      `workspace site '${name}' is not initialized; run dev:workspace:init first`,
    );
  }
  const config = readJson(path);
  if (config.version !== CONFIG_VERSION || config.name !== name) {
    throw new Error(`unsupported or malformed workspace site config: ${path}`);
  }
  return config;
}

function isPathInside(path, parent) {
  const rel = relative(resolve(parent), resolve(path));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

function hashName(name) {
  let value = 2166136261;
  for (const byte of Buffer.from(name)) {
    value ^= byte;
    value = Math.imul(value, 16777619);
  }
  return value >>> 0;
}

function checkPortAvailable(port, host = "127.0.0.1") {
  return new Promise((resolveCheck) => {
    const server = net.createServer();
    const finish = (result) => {
      server.removeAllListeners();
      resolveCheck(result);
    };
    server.once("error", (err) =>
      finish({ ok: false, code: err?.code, message: err?.message }),
    );
    server.once("listening", () => {
      server.close(() => finish({ ok: true }));
    });
    server.listen(port, host);
  });
}

async function portPairAvailable(port, check = checkPortAvailable) {
  const [http, ssh] = await Promise.all([check(port), check(port + 1)]);
  return { ok: http.ok && ssh.ok, http, ssh };
}

async function allocatePortPair({
  name,
  configuredPort,
  configs,
  check = checkPortAvailable,
}) {
  const reserved = new Set();
  for (const config of configs) {
    reserved.add(Number(config.base_port));
    reserved.add(Number(config.sshd_port));
  }
  const validate = async (port) => {
    if (!Number.isInteger(port) || port <= 0 || port >= 65_535) {
      throw new Error("base port must be an integer between 1 and 65534");
    }
    if (reserved.has(port) || reserved.has(port + 1)) {
      return { ok: false, reason: "reserved by another workspace site" };
    }
    const available = await portPairAvailable(port, check);
    return available.ok
      ? { ok: true }
      : { ok: false, reason: "already in use", detail: available };
  };

  if (configuredPort != null) {
    const port = Number(configuredPort);
    const result = await validate(port);
    if (!result.ok) {
      throw new Error(
        `cannot reserve ports ${port}-${port + 1}: ${result.reason}`,
      );
    }
    return port;
  }

  const pairCount = Math.floor((DEFAULT_PORT_MAX - DEFAULT_PORT_MIN + 1) / 2);
  const start = hashName(name) % pairCount;
  for (let offset = 0; offset < pairCount; offset += 1) {
    const pair = (start + offset) % pairCount;
    const port = DEFAULT_PORT_MIN + pair * 2;
    if ((await validate(port)).ok) return port;
  }
  throw new Error("unable to allocate a free workspace site port pair");
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? SRC_DIR,
    env: options.env ?? process.env,
    encoding: "utf8",
    stdio: options.stdio ?? "pipe",
    maxBuffer: options.maxBuffer ?? 20 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const detail = `${result.stderr ?? result.stdout ?? ""}`.trim();
    throw new Error(
      `${command} ${args.join(" ")} failed with exit status ${result.status ?? "unknown"}${detail ? `: ${detail}` : ""}`,
    );
  }
  return `${result.stdout ?? ""}`;
}

function runGit(args) {
  try {
    return run("git", args, { cwd: REPO_DIR }).trim();
  } catch {
    return "";
  }
}

function currentSourceState() {
  return {
    commit: runGit(["rev-parse", "HEAD"]) || null,
    branch: runGit(["branch", "--show-current"]) || null,
    dirty: !!runGit(["status", "--porcelain"]),
  };
}

function buildStatus() {
  const missing = REQUIRED_RUNTIME_FILES.filter(
    (path) => !existsSync(join(SRC_DIR, path)),
  );
  const outputTimes = GENERATED_BUILD_OUTPUTS.filter((path) =>
    existsSync(join(SRC_DIR, path)),
  ).map((path) => statSync(join(SRC_DIR, path)).mtimeMs);
  const sourceCommitSeconds = Number(
    runGit([
      "log",
      "-1",
      "--format=%ct",
      "--",
      ...BUILD_SOURCE_PATHS.map((path) => join("src", path)),
    ]),
  );
  const dirtySource = !!runGit([
    "status",
    "--porcelain",
    "--",
    ...BUILD_SOURCE_PATHS.map((path) => join("src", path)),
  ]);
  const oldestOutputMs =
    outputTimes.length === GENERATED_BUILD_OUTPUTS.length
      ? Math.min(...outputTimes)
      : undefined;
  const olderThanCommittedSource =
    oldestOutputMs != null &&
    Number.isFinite(sourceCommitSeconds) &&
    oldestOutputMs < sourceCommitSeconds * 1000;
  return {
    ready: missing.length === 0,
    missing,
    dirty_source: dirtySource,
    older_than_committed_source: olderThanCommittedSource,
    stale: missing.length > 0 || dirtySource || olderThanCommittedSource,
    oldest_output_at:
      oldestOutputMs == null ? null : new Date(oldestOutputMs).toISOString(),
    latest_source_commit_at:
      Number.isFinite(sourceCommitSeconds) && sourceCommitSeconds > 0
        ? new Date(sourceCommitSeconds * 1000).toISOString()
        : null,
  };
}

function buildSource() {
  run("pnpm", ["build:dev"], {
    cwd: SRC_DIR,
    stdio: "inherit",
    maxBuffer: 100 * 1024 * 1024,
  });
  return buildStatus();
}

function ensureRequiredBuildOutputs() {
  let status = buildStatus();
  if (!status.ready) {
    console.error(
      `Missing workspace runtime build outputs: ${status.missing.join(", ")}`,
    );
    console.error("Running pnpm build:dev once for this checkout.");
    status = buildSource();
  }
  if (!status.ready) {
    throw new Error(
      `required workspace runtime build outputs are still missing: ${status.missing.join(", ")}`,
    );
  }
  return status;
}

function shellQuote(value) {
  const text = `${value ?? ""}`;
  if (/^[A-Za-z0-9_./:@%+=,-]*$/.test(text)) return text || "''";
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function cliPath(config) {
  return join(config.src_dir, "packages", "cli", "dist", "bin", "cocalc.js");
}

function isInternalControlPlaneUrl(value) {
  const raw = `${value ?? ""}`.trim();
  if (!raw) return false;
  try {
    return new URL(raw).hostname.endsWith(".internal");
  } catch {
    return false;
  }
}

function cliGlobalArgs(config) {
  const args = [];
  if (config.profile) args.push("--profile", config.profile);
  if (config.api_url && !isInternalControlPlaneUrl(config.api_url)) {
    args.push("--api", config.api_url);
  }
  return args;
}

function jwtExpiresAt(value) {
  const token = `${value ?? ""}`.trim();
  if (!token) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(token.split(".")[1], "base64url").toString("utf8"),
    );
    return Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function assertProjectScopedAuthFresh(
  config,
  env = process.env,
  now = Date.now(),
) {
  if (!config.outer_project_id || config.profile) return;
  const expiresAt = jwtExpiresAt(
    env.COCALC_BEARER_TOKEN ?? env.COCALC_AGENT_TOKEN,
  );
  if (expiresAt != null && expiresAt <= now) {
    throw new Error(
      "the ambient CoCalc project token has expired; open a fresh project terminal or refresh the project session, then retry",
    );
  }
}

function parseCliJson(stdout) {
  const start = stdout.indexOf("{");
  if (start === -1) {
    throw new Error(`CoCalc CLI returned no JSON: ${stdout.trim()}`);
  }
  const payload = JSON.parse(stdout.slice(start));
  if (!payload.ok) {
    throw new Error(payload.error?.message ?? "CoCalc CLI command failed");
  }
  return payload.data;
}

function runCliJson(config, args) {
  assertProjectScopedAuthFresh(config);
  const output = run(
    process.execPath,
    [cliPath(config), ...cliGlobalArgs(config), ...args, "--json"],
    { cwd: config.src_dir },
  );
  return parseCliJson(output);
}

function runCliInteractive(config, args) {
  assertProjectScopedAuthFresh(config);
  run(process.execPath, [cliPath(config), ...cliGlobalArgs(config), ...args], {
    cwd: config.src_dir,
    stdio: "inherit",
  });
}

function selectProfileForAmbientAccount(profiles, accountId) {
  const normalized = `${accountId ?? ""}`.trim();
  if (!normalized || !Array.isArray(profiles)) return undefined;
  const matches = profiles.filter(
    (entry) =>
      `${entry?.account_id ?? ""}`.trim() === normalized &&
      `${entry?.profile ?? ""}`.trim() &&
      entry.profile !== "_env",
  );
  return matches.length === 1 ? `${matches[0].profile}` : undefined;
}

function selectAmbientAccountProfile(config, env = process.env) {
  if (config.profile) return config.profile;
  const accountId = `${env.COCALC_ACCOUNT_ID ?? ""}`.trim();
  if (!accountId) return undefined;
  try {
    const output = run(
      process.execPath,
      [cliPath(config), "auth", "list", "--json"],
      { cwd: config.src_dir },
    );
    const profile = selectProfileForAmbientAccount(
      parseCliJson(output),
      accountId,
    );
    if (!profile) return undefined;
    config.profile = profile;
    saveConfig(config);
    return profile;
  } catch {
    return undefined;
  }
}

function privateHostnamePolicy(config) {
  let policy;
  try {
    policy = runCliJson(config, [
      "project",
      "app",
      "private-hostname",
      "policy",
      "--project",
      config.outer_project_id,
    ]);
  } catch (err) {
    const message = `${err?.message ?? err}`;
    if (
      message.includes(
        "unknown function 'system.getProjectAppPrivateHostnamePolicy'",
      )
    ) {
      throw new Error(
        `the private-hostname API is not deployed on the site selected by CLI profile '${config.profile ?? "current"}'; use an outer project on a site where private hostnames are enabled, or deploy the feature there first`,
      );
    }
    throw err;
  }
  if (!policy.enabled) {
    throw new Error(
      `private hostnames are unavailable for outer project ${config.outer_project_id}: ${
        policy.warnings?.join(" ") || "disabled by site policy"
      }`,
    );
  }
  return policy;
}

function ordinaryAppUrl(config) {
  const origin = config.site_url ?? config.api_url;
  if (!origin || !config.outer_project_id) return null;
  try {
    const parsed = new URL(origin);
    if (
      !config.site_url &&
      (parsed.hostname.endsWith(".internal") ||
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1")
    ) {
      return null;
    }
  } catch {
    return null;
  }
  return `${origin.replace(/\/+$/, "")}/${config.outer_project_id}/apps/${config.app_id}/`;
}

function localUrl(config) {
  return `http://127.0.0.1:${config.base_port}/`;
}

function browserUrl(config) {
  return config.private_url ?? ordinaryAppUrl(config) ?? localUrl(config);
}

function extractBootstrapRegistrationUrl(...values) {
  const text = values
    .flat(Infinity)
    .filter((value) => typeof value === "string" || Buffer.isBuffer(value))
    .map((value) => `${value}`)
    .join("\n");
  const candidates = text.match(/https?:\/\/[^\s"'<>]+/g) ?? [];
  for (let i = candidates.length - 1; i >= 0; i -= 1) {
    const candidate = candidates[i].replace(/[),.;]+$/, "");
    try {
      const url = new URL(candidate);
      if (
        url.pathname.endsWith("/auth/sign-up") &&
        url.searchParams.has("registrationToken") &&
        url.searchParams.get("bootstrap") === "1"
      ) {
        return url.toString();
      }
    } catch {
      // Other log URLs are irrelevant.
    }
  }
  return null;
}

function rebaseBootstrapRegistrationUrl(config, loggedUrl) {
  if (!loggedUrl) return null;
  const parsed = new URL(loggedUrl);
  const relative = `${parsed.pathname.replace(/^\/+/, "")}${parsed.search}${parsed.hash}`;
  return new URL(relative, browserUrl(config)).toString();
}

function localBootstrapRegistrationUrl(config) {
  if (!existsSync(config.stdout_log)) return null;
  const output = readFileSync(config.stdout_log);
  const start = Math.max(
    0,
    Math.min(output.length, Number(config.local_log_start_bytes ?? 0) || 0),
  );
  const tail = output.subarray(Math.max(start, output.length - 1024 * 1024));
  return rebaseBootstrapRegistrationUrl(
    config,
    extractBootstrapRegistrationUrl(tail),
  );
}

function appSpec(config) {
  const locallySupervised = config.supervisor === "local";
  return {
    version: 1,
    id: config.app_id,
    title: `CoCalc workspace development: ${config.name}`,
    kind: "service",
    command: {
      exec: config.node_bin,
      args: [
        SCRIPT_PATH,
        "serve",
        "--name",
        config.name,
        "--sites-root",
        config.sites_root,
      ],
      cwd: config.src_dir,
      env: {
        COCALC_WORKSPACE_SITES_ROOT: config.sites_root,
      },
    },
    lifecycle: { mode: locallySupervised ? "unmanaged" : "managed" },
    network: {
      listen_host: "127.0.0.1",
      port: config.base_port,
      protocol: "http",
    },
    proxy: {
      base_path: `/apps/${config.app_id}`,
      strip_prefix: true,
      websocket: true,
      open_mode: "proxy",
      readiness_timeout_s: 120,
    },
    wake: {
      enabled: !locallySupervised,
      keep_warm_s: locallySupervised ? 0 : 86_400,
      startup_timeout_s: locallySupervised ? 0 : 120,
    },
  };
}

function writeAppSpec(config) {
  writeJsonAtomic(config.app_spec_path, appSpec(config));
}

async function initSite(opts) {
  const name = normalizeSiteName(opts.name);
  const root = sitesRoot(opts);
  return await withRegistryLock(root, async () => {
    const path = configPath(root, name);
    if (existsSync(path)) {
      const existing = readConfig(root, name);
      if (resolve(existing.src_dir) !== SRC_DIR) {
        throw new Error(
          `site '${name}' belongs to another checkout (${existing.src_dir}); choose another name`,
        );
      }
      return { created: false, config: existing };
    }
    const configs = readAllConfigs(root);
    const basePort = await allocatePortPair({
      name,
      configuredPort: opts.port,
      configs,
    });
    const dir = siteDir(root, name);
    const dataDir = resolve(opts.data_dir ?? join(dir, "data"));
    if (isPathInside(dataDir, REPO_DIR)) {
      throw new Error(
        `workspace data must be outside the source checkout; got ${dataDir}`,
      );
    }
    const collision = configs.find(
      (config) => resolve(config.data_dir) === dataDir,
    );
    if (collision) {
      throw new Error(
        `workspace data directory is already used by site '${collision.name}'`,
      );
    }
    const outerProjectId = normalizeProjectId(
      opts.project ?? process.env.COCALC_PROJECT_ID,
    );
    const source = currentSourceState();
    const now = new Date().toISOString();
    const config = {
      version: CONFIG_VERSION,
      name,
      created_at: now,
      updated_at: now,
      initialized_commit: source.commit,
      sites_root: root,
      site_dir: dir,
      src_dir: SRC_DIR,
      repo_dir: REPO_DIR,
      data_dir: dataDir,
      project_path: join(dataDir, "projects"),
      runtime_state_dir: join(dataDir, "runtime"),
      project_logs_dir: join(dataDir, "logs", "projects"),
      daemon_dir: join(dir, "daemon"),
      pid_file: join(dir, "daemon", "launchpad.pid"),
      stdout_log: join(dir, "logs", "launchpad.stdout.log"),
      app_spec_path: join(dir, "app-spec.json"),
      app_id: `cocalc-dev-${name}`,
      base_port: basePort,
      sshd_port: basePort + 1,
      node_bin: process.execPath,
      supervisor: opts.local
        ? "local"
        : outerProjectId
          ? "project-app"
          : "local",
      outer_project_id: outerProjectId ?? null,
      api_url: `${opts.api ?? process.env.COCALC_API_URL ?? ""}`.trim() || null,
      site_url: `${opts.site_url ?? ""}`.trim() || null,
      profile: `${opts.profile ?? ""}`.trim() || null,
      private_hostname: null,
      private_url: null,
    };
    for (const directory of [
      config.data_dir,
      config.project_path,
      config.runtime_state_dir,
      config.project_logs_dir,
      config.daemon_dir,
      dirname(config.stdout_log),
    ]) {
      mkdirSync(directory, { recursive: true });
    }
    writeJsonAtomic(path, config);
    writeAppSpec(config);
    return { created: true, config };
  });
}

function processCommandLine(pid) {
  try {
    return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " ");
  } catch {
    const result = spawnSync("ps", ["-o", "command=", "-p", `${pid}`], {
      encoding: "utf8",
    });
    return result.status === 0 ? `${result.stdout ?? ""}`.trim() : "";
  }
}

function localPid(config) {
  if (!existsSync(config.pid_file)) return undefined;
  const pid = Number(readFileSync(config.pid_file, "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 0) return undefined;
  try {
    process.kill(pid, 0);
  } catch {
    return undefined;
  }
  const command = processCommandLine(pid);
  if (
    !command.includes(SCRIPT_PATH) ||
    !command.includes("serve") ||
    !command.includes(config.name)
  ) {
    return undefined;
  }
  return pid;
}

async function httpReady(config, timeoutMs = 2_000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(localUrl(config), {
      redirect: "manual",
      signal: controller.signal,
    });
    return {
      ready: response.status >= 200 && response.status < 500,
      status: response.status,
    };
  } catch (err) {
    return { ready: false, error: `${err}` };
  } finally {
    clearTimeout(timer);
  }
}

async function waitForReady(config, timeoutMs = START_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    last = await httpReady(config);
    if (last.ready) return last;
    if (config.supervisor === "local" && !localPid(config)) {
      break;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  throw new Error(
    `workspace site '${config.name}' did not become ready within ${Math.round(timeoutMs / 1000)}s${last?.error ? `: ${last.error}` : ""}`,
  );
}

function saveConfig(config) {
  config.updated_at = new Date().toISOString();
  writeJsonAtomic(configPath(config.sites_root, config.name), config);
  writeAppSpec(config);
}

async function startLocal(config) {
  const existing = localPid(config);
  if (existing) {
    return {
      already_running: true,
      pid: existing,
      health: await httpReady(config),
    };
  }
  const pair = await portPairAvailable(config.base_port);
  if (!pair.ok) {
    throw new Error(
      `workspace site ports ${config.base_port}-${config.sshd_port} are unavailable`,
    );
  }
  mkdirSync(dirname(config.stdout_log), { recursive: true });
  config.local_log_start_bytes = existsSync(config.stdout_log)
    ? statSync(config.stdout_log).size
    : 0;
  saveConfig(config);
  const logFd = openSync(config.stdout_log, "a", 0o600);
  const child = spawn(
    config.node_bin,
    [
      SCRIPT_PATH,
      "serve",
      "--name",
      config.name,
      "--sites-root",
      config.sites_root,
    ],
    {
      cwd: config.src_dir,
      detached: true,
      env: {
        ...process.env,
        COCALC_WORKSPACE_SITES_ROOT: config.sites_root,
      },
      stdio: ["ignore", logFd, logFd],
    },
  );
  closeSync(logFd);
  child.unref();
  writeFileSync(config.pid_file, `${child.pid}\n`, { mode: 0o600 });
  try {
    const health = await waitForReady(config);
    return { already_running: false, pid: child.pid, health };
  } catch (err) {
    await stopLocal(config);
    throw err;
  }
}

async function stopLocal(config) {
  const pid = localPid(config);
  if (!pid) {
    try {
      unlinkSync(config.pid_file);
    } catch {
      // Missing stale PID file is expected.
    }
    return { stopped: false, already_stopped: true };
  }
  const signal = (name) => {
    try {
      if (process.platform === "linux") {
        process.kill(-pid, name);
      } else {
        process.kill(pid, name);
      }
    } catch {
      // The exact process may have exited between checks.
    }
  };
  signal("SIGTERM");
  for (let i = 0; i < 40; i += 1) {
    if (!localPid(config)) break;
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  if (localPid(config)) signal("SIGKILL");
  try {
    unlinkSync(config.pid_file);
  } catch {
    // Exact PID cleanup is best effort.
  }
  return { stopped: true, already_stopped: false };
}

function requireManagedSite(config) {
  if (config.supervisor !== "project-app" || !config.outer_project_id) {
    throw new Error(
      `site '${config.name}' has no outer project app supervisor; reinitialize with --project or use the local workflow`,
    );
  }
}

function attachLocalSiteToOuterProject(config, opts, env = process.env) {
  if (config.outer_project_id) return false;
  if (config.supervisor !== "local") {
    throw new Error(
      `site '${config.name}' has no outer project; reinitialize it with --project`,
    );
  }
  const outerProjectId = normalizeProjectId(
    opts.project ?? env.COCALC_PROJECT_ID,
  );
  if (!outerProjectId) {
    throw new Error(
      `site '${config.name}' is local-only; rerun with --project <outer-project-id> from inside the CoCalc project that should own its private hostname`,
    );
  }
  config.outer_project_id = outerProjectId;
  if (opts.api) config.api_url = `${opts.api}`.trim() || null;
  else if (env.COCALC_API_URL) {
    config.api_url = `${env.COCALC_API_URL}`.trim() || null;
  }
  if (opts.site_url) config.site_url = `${opts.site_url}`.trim() || null;
  if (opts.profile) config.profile = `${opts.profile}`.trim() || null;
  saveConfig(config);
  return true;
}

function applyConnectionOverrides(config, opts) {
  let changed = false;
  for (const [option, field] of [
    ["api", "api_url"],
    ["site_url", "site_url"],
    ["profile", "profile"],
  ]) {
    if (opts[option] == null) continue;
    const value = `${opts[option]}`.trim() || null;
    if (config[field] === value) continue;
    config[field] = value;
    changed = true;
  }
  if (changed) saveConfig(config);
  return changed;
}

function requireOuterProject(config) {
  if (!config.outer_project_id) {
    throw new Error(
      `site '${config.name}' is not attached to an outer CoCalc project`,
    );
  }
}

function syncManagedApp(config) {
  requireOuterProject(config);
  writeAppSpec(config);
  return runCliJson(config, [
    "project",
    "app",
    "upsert",
    "--project",
    config.outer_project_id,
    "--file",
    config.app_spec_path,
  ]);
}

function refreshPublicSiteUrl(config) {
  if (config.site_url) return config.site_url;
  try {
    const versions = runCliJson(config, ["dev", "runtime", "versions"]);
    const publicSiteUrl = `${versions?.remote?.public_site_url ?? ""}`.trim();
    if (!publicSiteUrl) return null;
    config.site_url = publicSiteUrl;
    saveConfig(config);
    return publicSiteUrl;
  } catch {
    return null;
  }
}

async function startSite(config) {
  const build = ensureRequiredBuildOutputs();
  if (config.supervisor === "project-app") {
    syncManagedApp(config);
    refreshPublicSiteUrl(config);
    const runtime = runCliJson(config, [
      "project",
      "app",
      "ensure-running",
      config.app_id,
      "--project",
      config.outer_project_id,
      "--timeout",
      "2m",
    ]);
    const logs = runCliJson(config, [
      "project",
      "app",
      "logs",
      config.app_id,
      "--project",
      config.outer_project_id,
      "--tail",
      "2000",
    ]);
    const admin_registration_url = rebaseBootstrapRegistrationUrl(
      config,
      extractBootstrapRegistrationUrl(logs.stdout, logs.stderr),
    );
    return {
      supervisor: config.supervisor,
      build,
      runtime,
      browser_url: browserUrl(config),
      admin_registration_url,
    };
  }
  const runtime = await startLocal(config);
  return {
    supervisor: config.supervisor,
    build,
    runtime,
    browser_url: browserUrl(config),
    admin_registration_url: localBootstrapRegistrationUrl(config),
  };
}

async function stopSite(config) {
  if (config.supervisor === "project-app") {
    requireManagedSite(config);
    const runtime = runCliJson(config, [
      "project",
      "app",
      "stop",
      config.app_id,
      "--project",
      config.outer_project_id,
    ]);
    return { supervisor: config.supervisor, runtime };
  }
  return { supervisor: config.supervisor, runtime: await stopLocal(config) };
}

async function statusSite(config) {
  let runtime;
  let adminRegistrationUrl;
  if (config.supervisor === "project-app") {
    try {
      runtime = runCliJson(config, [
        "project",
        "app",
        "status",
        config.app_id,
        "--project",
        config.outer_project_id,
      ]);
      adminRegistrationUrl = rebaseBootstrapRegistrationUrl(
        config,
        extractBootstrapRegistrationUrl(runtime.stdout, runtime.stderr),
      );
    } catch (err) {
      runtime = { state: "unknown", error: `${err?.message ?? err}` };
    }
  } else {
    const pid = localPid(config);
    runtime = {
      state: pid ? "running" : "stopped",
      pid: pid ?? null,
      health: pid ? await httpReady(config) : { ready: false },
    };
    adminRegistrationUrl = localBootstrapRegistrationUrl(config);
  }
  return {
    name: config.name,
    supervisor: config.supervisor,
    runtime,
    source: currentSourceState(),
    build: buildStatus(),
    paths: {
      source: config.src_dir,
      data: config.data_dir,
      projects: config.project_path,
      runtime_state: config.runtime_state_dir,
      project_logs: config.project_logs_dir,
      launchpad_log: config.stdout_log,
      app_spec: config.app_spec_path,
    },
    ports: {
      http: config.base_port,
      sshd: config.sshd_port,
    },
    app: {
      id: config.app_id,
      outer_project_id: config.outer_project_id,
      ordinary_url: ordinaryAppUrl(config),
      private_hostname: config.private_hostname,
      private_url: config.private_url,
      local_url: localUrl(config),
    },
    admin_registration_url: adminRegistrationUrl ?? null,
    trust: {
      runtime: "workspace",
      isolation: "none",
      warning:
        "Inner projects are trusted same-UID processes, not security boundaries.",
    },
  };
}

function launchpadEnvironment(config) {
  const keep = [
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "PATH",
    "LANG",
    "LANGUAGE",
    "LC_ALL",
    "LC_CTYPE",
    "TZ",
    "TERM",
    "TMPDIR",
    "TMP",
    "TEMP",
    "NODE_OPTIONS",
  ];
  const env = {};
  for (const key of keep) {
    if (process.env[key] != null) env[key] = process.env[key];
  }
  return {
    ...env,
    COCALC_PRODUCT: "launchpad",
    COCALC_DB: "pglite",
    COCALC_PROJECT_RUNTIME: "workspace",
    COCALC_DATA_DIR: config.data_dir,
    COCALC_PGLITE_DATA_DIR: join(config.data_dir, "pglite"),
    DATA: config.data_dir,
    COCALC_PROJECT_PATH: config.project_path,
    COCALC_WORKSPACE_RUNTIME_STATE: config.runtime_state_dir,
    COCALC_WORKSPACE_RUNTIME_LOGS: config.project_logs_dir,
    COCALC_WORKSPACE_RUNTIME_PROJECT_BIN: join(
      config.src_dir,
      "packages",
      "project",
      "bin",
      "cocalc-project.js",
    ),
    COCALC_WORKSPACE_RUNTIME_NODE: config.node_bin,
    COCALC_BUNDLE_DIR: config.src_dir,
    COCALC_BASE_PORT: `${config.base_port}`,
    COCALC_HTTP_PORT: `${config.base_port}`,
    COCALC_SSHD_PORT: `${config.sshd_port}`,
    COCALC_SOURCE_COMMIT: currentSourceState().commit ?? "",
    COCALC_OPEN_BROWSER: "0",
    COCALC_ALLOW_INSECURE_HTTP_MODE: "true",
    DEBUG_CONSOLE: "yes",
    HOST: "127.0.0.1",
    PORT: `${config.base_port}`,
  };
}

async function serveSite(config) {
  const entrypoint = join(
    config.src_dir,
    "packages",
    "launchpad",
    "bin",
    "start.js",
  );
  const child = spawn(config.node_bin, [entrypoint], {
    cwd: config.src_dir,
    detached: process.platform === "linux",
    env: launchpadEnvironment(config),
    stdio: "inherit",
  });
  let stopping = false;
  const stopChild = (signal) => {
    if (stopping) return;
    stopping = true;
    try {
      if (process.platform === "linux" && child.pid) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      // Child already exited.
    }
    const timer = setTimeout(() => {
      try {
        if (process.platform === "linux" && child.pid) {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch {
        // Child already exited.
      }
    }, 700);
    timer.unref();
  };
  process.once("SIGTERM", () => stopChild("SIGTERM"));
  process.once("SIGINT", () => stopChild("SIGINT"));
  return await new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      resolveExit(code ?? (signal ? 1 : 0));
    });
  });
}

function updatePrivateHostname(config, hostname) {
  config.private_hostname = hostname?.hostname ?? null;
  config.private_url = hostname?.url ?? null;
  saveConfig(config);
}

function hostnameOperation(config, opts) {
  if (opts.reserve && opts.release) {
    throw new Error("choose only one of --reserve or --release");
  }
  applyConnectionOverrides(config, opts);
  if (opts.reserve) attachLocalSiteToOuterProject(config, opts);
  requireOuterProject(config);
  selectAmbientAccountProfile(config);
  refreshPublicSiteUrl(config);
  if (opts.release) {
    const result = runCliJson(config, [
      "project",
      "app",
      "private-hostname",
      "release",
      config.app_id,
      "--project",
      config.outer_project_id,
    ]);
    updatePrivateHostname(config, null);
    return result;
  }
  if (opts.reserve) {
    privateHostnamePolicy(config);
    syncManagedApp(config);
    const result = runCliJson(config, [
      "project",
      "app",
      "private-hostname",
      "reserve",
      config.app_id,
      "--project",
      config.outer_project_id,
    ]);
    updatePrivateHostname(config, result.hostname);
    return result;
  }
  const result = runCliJson(config, [
    "project",
    "app",
    "private-hostname",
    "get",
    config.app_id,
    "--project",
    config.outer_project_id,
  ]);
  updatePrivateHostname(config, result.hostname);
  return result;
}

function openPrivateHostname(config, opts) {
  applyConnectionOverrides(config, opts);
  if (opts.reserve) attachLocalSiteToOuterProject(config, opts);
  requireOuterProject(config);
  selectAmbientAccountProfile(config);
  refreshPublicSiteUrl(config);
  privateHostnamePolicy(config);
  syncManagedApp(config);
  const args = [
    "project",
    "app",
    "private-hostname",
    "open",
    config.app_id,
    "--project",
    config.outer_project_id,
  ];
  if (opts.reserve) args.push("--reserve");
  const result = runCliJson(config, args);
  updatePrivateHostname(config, {
    hostname: new URL(result.url).hostname,
    url: result.url,
  });
  return result;
}

function environmentExports(config) {
  const values = {
    COCALC_WORKSPACE_SITE_NAME: config.name,
    COCALC_WORKSPACE_SITE_ROOT: config.site_dir,
    COCALC_WORKSPACE_SITE_DATA: config.data_dir,
    COCALC_WORKSPACE_SITE_PORT: `${config.base_port}`,
    COCALC_WORKSPACE_SITE_LOCAL_URL: localUrl(config),
    COCALC_WORKSPACE_SITE_APP_ID: config.app_id,
    COCALC_WORKSPACE_SITE_URL: browserUrl(config),
  };
  if (config.outer_project_id) {
    values.COCALC_WORKSPACE_SITE_PROJECT_ID = config.outer_project_id;
  }
  if (config.api_url) values.COCALC_API_URL = config.api_url;
  return values;
}

function printHuman(command, value) {
  if (command === "env") {
    for (const [key, entry] of Object.entries(value)) {
      console.log(`export ${key}=${shellQuote(entry)}`);
    }
    return;
  }
  if (command === "init") {
    const config = value.config;
    console.log(
      `${value.created ? "initialized" : "already initialized"} workspace site '${config.name}'`,
    );
    console.log(`supervisor: ${config.supervisor}`);
    console.log(`source:     ${config.src_dir}`);
    console.log(`data:       ${config.data_dir}`);
    console.log(`ports:      ${config.base_port}-${config.sshd_port}`);
    console.log(`app id:     ${config.app_id}`);
    console.log(
      `next:       pnpm -C ${shellQuote(config.src_dir)} dev:workspace:start --name ${shellQuote(config.name)}`,
    );
    return;
  }
  if (command === "start" || command === "restart") {
    console.log(`workspace site: ${value.runtime.state ?? "running"}`);
    console.log(`supervisor:    ${value.supervisor}`);
    console.log(`browser URL:   ${value.browser_url}`);
    if (value.admin_registration_url) {
      console.log(`admin signup:  ${value.admin_registration_url}`);
    } else {
      console.log(
        "admin signup:  not present (an admin may already be registered)",
      );
    }
    return;
  }
  if (command === "status") {
    console.log(
      `workspace site '${value.name}': ${value.runtime.state ?? "unknown"}`,
    );
    console.log(`supervisor: ${value.supervisor}`);
    console.log(`source:     ${value.paths.source}`);
    console.log(`commit:     ${value.source.commit ?? "unknown"}`);
    console.log(`dirty:      ${value.source.dirty ? "yes" : "no"}`);
    console.log(
      `build:      ${value.build.stale ? "stale or dirty" : "current"}`,
    );
    console.log(`data:       ${value.paths.data}`);
    console.log(`ports:      ${value.ports.http}-${value.ports.sshd}`);
    console.log(`local URL:  ${value.app.local_url}`);
    if (value.app.ordinary_url) {
      console.log(`app URL:    ${value.app.ordinary_url}`);
    }
    if (value.app.private_url) {
      console.log(`private:    ${value.app.private_url}`);
    }
    if (value.admin_registration_url) {
      console.log(`admin:      ${value.admin_registration_url}`);
    }
    console.log(`warning:    ${value.trust.warning}`);
    if (value.runtime.error) console.log(`error:      ${value.runtime.error}`);
    return;
  }
  console.log(JSON.stringify(value, null, 2));
}

async function showLogs(config, opts) {
  const tail = Number(opts.tail ?? 200);
  if (!Number.isInteger(tail) || tail <= 0) {
    throw new Error("--tail must be a positive integer");
  }
  if (config.supervisor === "project-app") {
    if (opts.follow) {
      throw new Error(
        "--follow is unavailable for project-app supervision; rerun logs to refresh the bounded app output",
      );
    }
    runCliInteractive(config, [
      "project",
      "app",
      "logs",
      config.app_id,
      "--project",
      config.outer_project_id,
      "--tail",
      `${tail}`,
    ]);
    return null;
  }
  mkdirSync(dirname(config.stdout_log), { recursive: true });
  if (!existsSync(config.stdout_log)) writeFileSync(config.stdout_log, "");
  const args = ["-n", `${tail}`];
  if (opts.follow) args.push("-f");
  args.push(config.stdout_log);
  run("tail", args, { cwd: config.src_dir, stdio: "inherit" });
  return null;
}

async function main(argv = process.argv.slice(2)) {
  const { command, opts } = parseArgs(argv);
  if (opts.help || !command) {
    console.log(usage());
    return 0;
  }
  if (!opts.name) {
    throw new Error("--name is required");
  }
  const name = normalizeSiteName(opts.name);
  const root = sitesRoot(opts);

  let result;
  if (command === "init") {
    result = await initSite(opts);
  } else {
    const config = readConfig(root, name);
    switch (command) {
      case "start":
        result = await startSite(config);
        break;
      case "stop":
        result = await stopSite(config);
        break;
      case "restart":
        await stopSite(config);
        result = await startSite(config);
        break;
      case "status":
        result = await statusSite(config);
        break;
      case "logs":
        result = await showLogs(config, opts);
        break;
      case "env":
        result = environmentExports(config);
        break;
      case "build":
        result = buildSource();
        break;
      case "hostname":
        result = hostnameOperation(config, opts);
        break;
      case "open":
        result = openPrivateHostname(config, opts);
        break;
      case "serve":
        return await serveSite(config);
      default:
        throw new Error(`unknown command '${command}'\n\n${usage()}`);
    }
  }
  if (result != null) {
    if (opts.json) {
      console.log(JSON.stringify(result, null, 2));
    } else {
      printHuman(command, result);
    }
  }
  return 0;
}

if (require.main === module) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      console.error(`workspace site error: ${err?.message ?? err}`);
      process.exitCode = 1;
    },
  );
}

module.exports = {
  allocatePortPair,
  appSpec,
  applyConnectionOverrides,
  assertProjectScopedAuthFresh,
  attachLocalSiteToOuterProject,
  browserUrl,
  buildStatus,
  defaultSitesRoot,
  environmentExports,
  extractBootstrapRegistrationUrl,
  hashName,
  initSite,
  isInternalControlPlaneUrl,
  isPathInside,
  launchpadEnvironment,
  localBootstrapRegistrationUrl,
  normalizeProjectId,
  normalizeSiteName,
  ordinaryAppUrl,
  parseArgs,
  parseCliJson,
  portPairAvailable,
  privateHostnamePolicy,
  readConfig,
  rebaseBootstrapRegistrationUrl,
  refreshPublicSiteUrl,
  selectProfileForAmbientAccount,
  siteDir,
  sitesRoot,
};
