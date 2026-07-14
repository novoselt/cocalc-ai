/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_MAINTENANCE_TTL_MS = 5 * 60_000;
const STATE_FILENAME = "project-runtime-maintenance.json";

export type ProjectRuntimeMaintenanceState = {
  reason: string;
  started_at: string;
  expires_at: string;
  pid: number;
};

function statePath(): string {
  const dataDir = process.env.COCALC_DATA ?? process.env.DATA ?? os.tmpdir();
  return path.join(dataDir, STATE_FILENAME);
}

export function beginProjectRuntimeMaintenance({
  reason,
  ttlMs = DEFAULT_MAINTENANCE_TTL_MS,
}: {
  reason: string;
  ttlMs?: number;
}): ProjectRuntimeMaintenanceState {
  const now = Date.now();
  const state: ProjectRuntimeMaintenanceState = {
    reason,
    started_at: new Date(now).toISOString(),
    expires_at: new Date(now + Math.max(1_000, ttlMs)).toISOString(),
    pid: process.pid,
  };
  const filename = statePath();
  const temporary = `${filename}.tmp-${process.pid}-${now}`;
  fs.mkdirSync(path.dirname(filename), { recursive: true });
  fs.writeFileSync(temporary, `${JSON.stringify(state)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, filename);
  return state;
}

export function endProjectRuntimeMaintenance(): void {
  try {
    fs.unlinkSync(statePath());
  } catch (err: any) {
    if (err?.code !== "ENOENT") throw err;
  }
}

export function getProjectRuntimeMaintenanceState():
  | ProjectRuntimeMaintenanceState
  | undefined {
  const filename = statePath();
  try {
    const state = JSON.parse(
      fs.readFileSync(filename, "utf8"),
    ) as ProjectRuntimeMaintenanceState;
    const expiresAt = Date.parse(`${state?.expires_at ?? ""}`);
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      endProjectRuntimeMaintenance();
      return undefined;
    }
    return state;
  } catch (err: any) {
    if (err?.code === "ENOENT") return undefined;
    // A malformed state must not permanently deny project starts.
    try {
      fs.unlinkSync(filename);
    } catch {
      // best effort
    }
    return undefined;
  }
}

export const __test__ = { statePath };
