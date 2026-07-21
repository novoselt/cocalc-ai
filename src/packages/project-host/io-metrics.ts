import type {
  HostIoContainmentMetrics,
  HostIoDeviceMetrics,
  HostIoProjectMetrics,
} from "@cocalc/conat/hub/api/hosts";
import { execFile } from "node:child_process";
import { readFile, readdir, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const POLICY_PATH = "/etc/cocalc/project-io-policy.json";
const POLICY_OVERRIDE_PATH = "/etc/cocalc/project-io-policy.override.json";
const PROJECT_POOL = "/sys/fs/cgroup/cocalc-project-pool";
const MAX_LEAVES_PER_SAMPLE = 32;
const TOP_PROJECTS = 10;

type IoCounters = {
  readBytes: number;
  writeBytes: number;
  readIos: number;
  writeIos: number;
};

type TimedCounters = IoCounters & { at: number };

const previousLeaves = new Map<string, TimedCounters>();
let leafCursor = 0;

function finite(value: unknown): number | undefined {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : undefined;
}

export function parseIoStat(raw: string): IoCounters {
  const counters: IoCounters = {
    readBytes: 0,
    writeBytes: 0,
    readIos: 0,
    writeIos: 0,
  };
  for (const line of raw.split(/\r?\n/u)) {
    const fields = line.trim().split(/\s+/u);
    if (!fields[0]?.includes(":")) continue;
    for (const field of fields.slice(1)) {
      const [key, text] = field.split("=", 2);
      const value = finite(text);
      if (value == null) continue;
      if (key === "rbytes") counters.readBytes += value;
      if (key === "wbytes") counters.writeBytes += value;
      if (key === "rios") counters.readIos += value;
      if (key === "wios") counters.writeIos += value;
    }
  }
  return counters;
}

export function parseIoPressure(raw: string): {
  somePercent?: number;
  fullPercent?: number;
  someTotal?: number;
  fullTotal?: number;
} {
  const result: ReturnType<typeof parseIoPressure> = {};
  for (const line of raw.split(/\r?\n/u)) {
    const fields = line.trim().split(/\s+/u);
    const kind = fields.shift();
    const values = new Map(
      fields.map((field) => field.split("=", 2) as [string, string]),
    );
    if (kind === "some") {
      result.somePercent = finite(values.get("avg10"));
      result.someTotal = finite(values.get("total"));
    }
    if (kind === "full") {
      result.fullPercent = finite(values.get("avg10"));
      result.fullTotal = finite(values.get("total"));
    }
  }
  return result;
}

function rates(
  previous: TimedCounters | undefined,
  current: TimedCounters,
): Omit<HostIoProjectMetrics, "project_id" | "sampled_at"> {
  if (!previous || current.at <= previous.at) return {};
  const seconds = (current.at - previous.at) / 1000;
  const rate = (next: number, before: number) =>
    Math.max(0, Math.round((next - before) / seconds));
  return {
    read_bytes_per_second: rate(current.readBytes, previous.readBytes),
    write_bytes_per_second: rate(current.writeBytes, previous.writeBytes),
    read_iops: rate(current.readIos, previous.readIos),
    write_iops: rate(current.writeIos, previous.writeIos),
  };
}

function merge(left: any, right: any): any {
  if (!right || typeof right !== "object" || Array.isArray(right)) return left;
  const output = { ...(left ?? {}) };
  for (const [key, value] of Object.entries(right)) {
    output[key] =
      value && typeof value === "object" && !Array.isArray(value)
        ? merge(output[key], value)
        : value;
  }
  return output;
}

async function readJson(path: string): Promise<any> {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (err: any) {
    if (err?.code === "ENOENT") return {};
    throw err;
  }
}

async function readPolicy(): Promise<any> {
  return merge(
    await readJson(POLICY_PATH),
    await readJson(POLICY_OVERRIDE_PATH),
  );
}

async function discoverDevices(
  mountpoint: string,
): Promise<HostIoDeviceMetrics[]> {
  const { stdout } = await execFileAsync(
    "/usr/bin/btrfs",
    ["filesystem", "show", "--raw", mountpoint],
    { timeout: 5000, maxBuffer: 1024 * 1024 },
  );
  const paths = [...stdout.matchAll(/\bpath\s+(\S+)$/gmu)].map(
    (match) => match[1],
  );
  return await Promise.all(
    paths.map(async (device) => {
      const resolved = await realpath(device);
      const sysBlock = join("/sys/class/block", basename(resolved));
      const [major_minor, schedulerRaw] = await Promise.all([
        readFile(join(sysBlock, "dev"), "utf8"),
        readFile(join(sysBlock, "queue/scheduler"), "utf8").catch(() => ""),
      ]);
      const scheduler = /\[([^\]]+)\]/u.exec(schedulerRaw)?.[1];
      return {
        device,
        major_minor: major_minor.trim(),
        ...(scheduler ? { scheduler } : {}),
      };
    }),
  );
}

async function sampleLeaves(now: number): Promise<{
  projects: HostIoProjectMetrics[];
  sampled: number;
  total: number;
}> {
  const entries = (await readdir(PROJECT_POOL, { withFileTypes: true })).filter(
    (entry) =>
      entry.isDirectory() && /^project-[0-9a-f-]{36}$/u.test(entry.name),
  );
  if (entries.length === 0) return { projects: [], sampled: 0, total: 0 };
  const count = Math.min(MAX_LEAVES_PER_SAMPLE, entries.length);
  const selected = Array.from(
    { length: count },
    (_, offset) => entries[(leafCursor + offset) % entries.length],
  );
  leafCursor = (leafCursor + count) % entries.length;
  const projects = await Promise.all(
    selected.map(async (entry): Promise<HostIoProjectMetrics | undefined> => {
      try {
        const project_id = entry.name.slice("project-".length);
        const counters = parseIoStat(
          await readFile(join(PROJECT_POOL, entry.name, "io.stat"), "utf8"),
        );
        const current = { ...counters, at: now };
        const previous = previousLeaves.get(project_id);
        previousLeaves.set(project_id, current);
        return {
          project_id,
          sampled_at: new Date(now).toISOString(),
          ...rates(previous, current),
        };
      } catch {
        return undefined;
      }
    }),
  );
  return {
    projects: projects
      .filter((value): value is HostIoProjectMetrics => value != null)
      .sort(
        (a, b) =>
          (b.read_bytes_per_second ?? 0) +
          (b.write_bytes_per_second ?? 0) -
          ((a.read_bytes_per_second ?? 0) + (a.write_bytes_per_second ?? 0)),
      )
      .slice(0, TOP_PROJECTS),
    sampled: selected.length,
    total: entries.length,
  };
}

export async function readIoContainmentMetrics(): Promise<HostIoContainmentMetrics> {
  const now = Date.now();
  let policy: any = {};
  let policyError: string | undefined;
  try {
    policy = await readPolicy();
  } catch (err) {
    policyError = `${err}`;
  }
  const mountpoint = `${policy.mountpoint ?? "/mnt/cocalc"}`;
  const mode = ["disabled", "observe", "enforce"].includes(policy.mode)
    ? policy.mode
    : "invalid";
  try {
    const [devices, ioMax, pressureRaw, leaves, legacy] = await Promise.all([
      discoverDevices(mountpoint),
      readFile(join(PROJECT_POOL, "io.max"), "utf8"),
      readFile(join(PROJECT_POOL, "io.pressure"), "utf8"),
      sampleLeaves(now),
      readFile(join(PROJECT_POOL, "legacy/cgroup.procs"), "utf8").catch(
        () => "",
      ),
    ]);
    const pressure = parseIoPressure(pressureRaw);
    return {
      collected_at: new Date(now).toISOString(),
      policy_mode: mode,
      policy_version: finite(policy.version),
      policy_profile: policy.profile,
      capacity_source: policy.capacitySource,
      mountpoint,
      filesystem: "btrfs",
      capability: mode === "enforce" ? "enabled" : "available",
      pool_cgroup: PROJECT_POOL,
      pool_io_max: ioMax.trim(),
      pressure_some_percent: pressure.somePercent,
      pressure_full_percent: pressure.fullPercent,
      pressure_some_total: pressure.someTotal,
      pressure_full_total: pressure.fullTotal,
      devices,
      top_projects: leaves.projects,
      sampled_project_count: leaves.sampled,
      total_project_count: leaves.total,
      stale_project_count: Math.max(0, leaves.total - leaves.sampled),
      truncated: leaves.total > leaves.sampled,
      legacy_process_count: legacy.split(/\s+/u).filter(Boolean).length,
      ...(policyError ? { last_reconcile_error: policyError } : {}),
    };
  } catch (err) {
    return {
      collected_at: new Date(now).toISOString(),
      policy_mode: mode,
      policy_version: finite(policy.version),
      policy_profile: policy.profile,
      capacity_source: policy.capacitySource,
      mountpoint,
      capability: "unsupported",
      capability_reason: `${err}`,
      pool_cgroup: PROJECT_POOL,
      devices: [],
      top_projects: [],
      sampled_project_count: 0,
      total_project_count: 0,
      stale_project_count: 0,
      truncated: false,
      ...(policyError ? { last_reconcile_error: policyError } : {}),
    };
  }
}

export const __test__ = { parseIoPressure, parseIoStat, rates };
