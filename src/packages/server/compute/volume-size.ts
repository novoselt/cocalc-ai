/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ManagedComputeProviderId } from "./types";

export const NEBIUS_COMPUTE_VOLUME_INCREMENT_GB = 93;

export function effectiveComputeVolumeSizeGb(
  provider: ManagedComputeProviderId,
  requestedSizeGb: number,
): number {
  if (provider !== "nebius") return requestedSizeGb;
  return Math.max(
    NEBIUS_COMPUTE_VOLUME_INCREMENT_GB,
    Math.ceil(requestedSizeGb / NEBIUS_COMPUTE_VOLUME_INCREMENT_GB) *
      NEBIUS_COMPUTE_VOLUME_INCREMENT_GB,
  );
}
