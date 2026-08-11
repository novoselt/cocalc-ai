/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { KernelStatus } from "@cocalc/conat/project/api/jupyter";

export function isKernelStopConfirmed({
  status,
  targetIdentity,
}: {
  status?: KernelStatus;
  targetIdentity?: string;
}): boolean {
  if (status == null) {
    return false;
  }
  if (status.backend_state !== "running") {
    return true;
  }
  return (
    targetIdentity != null &&
    status.identity != null &&
    status.identity !== targetIdentity
  );
}
