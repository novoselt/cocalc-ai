/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export const PROJECT_DISK_QUOTA_EXCEEDED_CODE = "project_disk_quota_exceeded";

const MIN_STARTUP_HEADROOM_BYTES = 16_000_000;
const MAX_STARTUP_HEADROOM_BYTES = 64_000_000;
const STARTUP_HEADROOM_FRACTION = 0.01;

export type ProjectDiskQuota = {
  size: number;
  used: number;
};

export type ProjectStartFailure = {
  code: string;
};

export function projectDiskStartupHeadroomBytes(size: number): number {
  if (!Number.isFinite(size) || size <= 0) return 0;
  return Math.min(
    MAX_STARTUP_HEADROOM_BYTES,
    Math.max(
      MIN_STARTUP_HEADROOM_BYTES,
      Math.ceil(size * STARTUP_HEADROOM_FRACTION),
    ),
  );
}

export function isProjectDiskQuotaStartBlocked(
  quota: ProjectDiskQuota,
): boolean {
  const used = Number(quota.used);
  const size = Number(quota.size);
  if (!Number.isFinite(used) || !Number.isFinite(size) || size <= 0) {
    return false;
  }
  return size - used <= projectDiskStartupHeadroomBytes(size);
}

function collectErrorText(
  value: unknown,
  parts: string[],
  seen: Set<unknown>,
): void {
  if (value == null || seen.has(value)) return;
  if (typeof value === "string") {
    parts.push(value);
    return;
  }
  if (typeof value !== "object") {
    parts.push(`${value}`);
    return;
  }
  seen.add(value);
  if (value instanceof Error) {
    parts.push(value.message, value.name);
  }
  for (const nested of Object.values(value as Record<string, unknown>)) {
    collectErrorText(nested, parts, seen);
  }
}

export function isProjectDiskQuotaError(value: unknown): boolean {
  const parts: string[] = [];
  collectErrorText(value, parts, new Set());
  const text = parts.join("\n").toLowerCase();
  return (
    text.includes(PROJECT_DISK_QUOTA_EXCEEDED_CODE) ||
    text.includes("project disk quota exceeded") ||
    text.includes("project disk quota is full") ||
    text.includes("project disk quota almost exhausted") ||
    text.includes("disk quota exceeded")
  );
}

export function projectStartFailureFromError(
  value: unknown,
): ProjectStartFailure | undefined {
  if (isProjectDiskQuotaError(value)) {
    return { code: PROJECT_DISK_QUOTA_EXCEEDED_CODE };
  }
}
