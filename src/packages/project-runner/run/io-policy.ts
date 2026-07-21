/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { readFile } from "node:fs/promises";

export type ProjectIoPolicyMode = "disabled" | "observe" | "enforce";
export type ProjectIoClass = "standard" | "member" | "premium";

export interface ProjectIoLimits {
  rbps: number;
  wbps: number;
  riops: number;
  wiops: number;
}

export interface ProjectIoLeafClass extends ProjectIoLimits {
  weight: number;
}

export interface ProjectIoPolicy {
  version: 1;
  mode: ProjectIoPolicyMode;
  mountpoint: string;
  profile: string;
  capacitySource: string;
  pool: ProjectIoLimits;
  leafClasses: Record<ProjectIoClass, ProjectIoLeafClass>;
  adaptive: {
    enabled: boolean;
    sampleMs: number;
    enterSamples: number;
    recoverSamples: number;
  };
  ioCost: { mode: "disabled" | "observe" | "enforce" };
}

export const PROJECT_IO_POLICY_PATH = "/etc/cocalc/project-io-policy.json";
export const PROJECT_IO_POLICY_OVERRIDE_PATH =
  "/etc/cocalc/project-io-policy.override.json";

const DEFAULT_LIMITS: ProjectIoLimits = {
  rbps: 0,
  wbps: 0,
  riops: 0,
  wiops: 0,
};

export const DEFAULT_PROJECT_IO_POLICY: ProjectIoPolicy = {
  version: 1,
  mode: "disabled",
  mountpoint: "/mnt/cocalc",
  profile: "unconfigured",
  capacitySource: "unconfigured",
  pool: { ...DEFAULT_LIMITS },
  leafClasses: {
    standard: { ...DEFAULT_LIMITS, weight: 100 },
    member: { ...DEFAULT_LIMITS, weight: 200 },
    premium: { ...DEFAULT_LIMITS, weight: 400 },
  },
  adaptive: {
    enabled: false,
    sampleMs: 5_000,
    enterSamples: 6,
    recoverSamples: 24,
  },
  ioCost: { mode: "disabled" },
};

function object(value: unknown): Record<string, any> {
  return value != null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function positiveInteger(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(value: unknown, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function parseLimits(
  value: unknown,
  fallback: ProjectIoLimits,
  path: string,
): ProjectIoLimits {
  const row = object(value);
  return {
    rbps: nonNegativeInteger(row.rbps ?? fallback.rbps, `${path}.rbps`),
    wbps: nonNegativeInteger(row.wbps ?? fallback.wbps, `${path}.wbps`),
    riops: nonNegativeInteger(row.riops ?? fallback.riops, `${path}.riops`),
    wiops: nonNegativeInteger(row.wiops ?? fallback.wiops, `${path}.wiops`),
  };
}

function parseMode(value: unknown): ProjectIoPolicyMode {
  if (value === "disabled" || value === "observe" || value === "enforce") {
    return value;
  }
  throw new Error("mode must be disabled, observe, or enforce");
}

export function normalizeProjectIoClass(value: unknown): ProjectIoClass {
  if (value === "member" || value === "premium") return value;
  return "standard";
}

function mergePolicyObjects(
  base: Record<string, any>,
  override: Record<string, any>,
): Record<string, any> {
  return {
    ...base,
    ...override,
    pool: { ...object(base.pool), ...object(override.pool) },
    leafClasses: {
      ...object(base.leafClasses),
      ...Object.fromEntries(
        Object.entries(object(override.leafClasses)).map(([key, value]) => [
          key,
          { ...object(object(base.leafClasses)[key]), ...object(value) },
        ]),
      ),
    },
    adaptive: { ...object(base.adaptive), ...object(override.adaptive) },
    ioCost: { ...object(base.ioCost), ...object(override.ioCost) },
  };
}

export function parseProjectIoPolicy(value: unknown): ProjectIoPolicy {
  const row = object(value);
  if (Number(row.version) !== 1) {
    throw new Error("project I/O policy version must be 1");
  }
  const mode = parseMode(row.mode);
  const pool = parseLimits(row.pool, DEFAULT_LIMITS, "pool");
  const leafRows = object(row.leafClasses);
  const leafClasses = Object.fromEntries(
    (["standard", "member", "premium"] as const).map((name) => {
      const defaults = DEFAULT_PROJECT_IO_POLICY.leafClasses[name];
      const limits = parseLimits(
        leafRows[name],
        defaults,
        `leafClasses.${name}`,
      );
      const weight = positiveInteger(
        object(leafRows[name]).weight ?? defaults.weight,
        `leafClasses.${name}.weight`,
      );
      if (weight > 10_000) {
        throw new Error(`leafClasses.${name}.weight must not exceed 10000`);
      }
      return [name, { ...limits, weight }];
    }),
  ) as Record<ProjectIoClass, ProjectIoLeafClass>;
  const adaptive = object(row.adaptive);
  const ioCost = object(row.ioCost);
  const ioCostMode = `${ioCost.mode ?? "disabled"}`;
  if (!["disabled", "observe", "enforce"].includes(ioCostMode)) {
    throw new Error("ioCost.mode must be disabled, observe, or enforce");
  }
  const policy: ProjectIoPolicy = {
    version: 1,
    mode,
    mountpoint: `${row.mountpoint ?? ""}`.trim() || "/mnt/cocalc",
    profile: `${row.profile ?? ""}`.trim() || "unconfigured",
    capacitySource: `${row.capacitySource ?? ""}`.trim() || "unconfigured",
    pool,
    leafClasses,
    adaptive: {
      enabled: adaptive.enabled === true,
      sampleMs: positiveInteger(
        adaptive.sampleMs ?? 5_000,
        "adaptive.sampleMs",
      ),
      enterSamples: positiveInteger(
        adaptive.enterSamples ?? 6,
        "adaptive.enterSamples",
      ),
      recoverSamples: positiveInteger(
        adaptive.recoverSamples ?? 24,
        "adaptive.recoverSamples",
      ),
    },
    ioCost: { mode: ioCostMode as ProjectIoPolicy["ioCost"]["mode"] },
  };
  if (mode === "enforce") {
    for (const [scope, limits] of [
      ["pool", policy.pool],
      ...Object.entries(policy.leafClasses),
    ] as Array<[string, ProjectIoLimits]>) {
      for (const [key, limit] of Object.entries(limits)) {
        if (key === "weight") continue;
        if (!(limit > 0)) {
          throw new Error(`${scope}.${key} must be configured in enforce mode`);
        }
      }
    }
  }
  return policy;
}

async function readJson(
  path: string,
): Promise<Record<string, any> | undefined> {
  try {
    return object(JSON.parse(await readFile(path, "utf8")));
  } catch (err: any) {
    if (err?.code === "ENOENT") return;
    throw new Error(`unable to read project I/O policy ${path}: ${err}`);
  }
}

export async function loadProjectIoPolicy({
  policyPath = PROJECT_IO_POLICY_PATH,
  overridePath = PROJECT_IO_POLICY_OVERRIDE_PATH,
}: {
  policyPath?: string;
  overridePath?: string;
} = {}): Promise<ProjectIoPolicy> {
  const base =
    (await readJson(policyPath)) ?? (DEFAULT_PROJECT_IO_POLICY as any);
  const override = (await readJson(overridePath)) ?? {};
  return parseProjectIoPolicy(mergePolicyObjects(base, override));
}

export function effectiveProjectIoClass(
  policy: ProjectIoPolicy,
  value: unknown,
): ProjectIoLeafClass & { name: ProjectIoClass } {
  const name = normalizeProjectIoClass(value);
  return { name, ...policy.leafClasses[name] };
}
