/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ComputeVm } from "@cocalc/conat/hub/api/compute";

const NEBIUS_EXPECTED_START_MS = 2 * 60_000;
const NEBIUS_LONG_START_MS = 2 * NEBIUS_EXPECTED_START_MS;
const STARTING_STATES = new Set(["requested", "provisioning", "starting"]);

function elapsedLabel(elapsedMs: number): string {
  const seconds = Math.max(0, Math.floor(elapsedMs / 1_000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds ? `${minutes}m ${remainingSeconds}s` : `${minutes}m`;
}

export interface VmStartupExpectation {
  text: string;
  takingLongerThanUsual: boolean;
}

export function vmStartupExpectation(
  vm: Pick<
    ComputeVm,
    "provider" | "state" | "desired_state" | "current_instance_timing"
  >,
  now = Date.now(),
): VmStartupExpectation | undefined {
  if (
    vm.provider !== "nebius" ||
    vm.desired_state !== "running" ||
    !STARTING_STATES.has(vm.state)
  ) {
    return;
  }
  const createdAt = vm.current_instance_timing?.created_at;
  const createdAtMs = createdAt == null ? NaN : new Date(createdAt).valueOf();
  if (!Number.isFinite(createdAtMs)) {
    return {
      text: "Usually SSH-ready in about 2 min",
      takingLongerThanUsual: false,
    };
  }
  const elapsedMs = Math.max(0, now - createdAtMs);
  const elapsed = `${elapsedLabel(elapsedMs)} elapsed`;
  if (elapsedMs >= NEBIUS_LONG_START_MS) {
    return {
      text: `Taking longer than usual · ${elapsed}`,
      takingLongerThanUsual: true,
    };
  }
  return {
    text: `Usually SSH-ready in about 2 min · ${elapsed}`,
    takingLongerThanUsual: false,
  };
}
