/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { HostExamRunStatus } from "@cocalc/conat/hub/api/hosts";

export function validateExamCapacityIncrease({
  current,
  requested,
  status,
}: {
  current: number;
  requested: number;
  status: HostExamRunStatus;
}): void {
  if (status !== "ready" && status !== "open") {
    throw new Error(
      `exam capacity can only increase while the run is ready or open (status=${status})`,
    );
  }
  if (!Number.isInteger(requested) || requested < 1 || requested > 1_000) {
    throw new Error("max_projects must be an integer between 1 and 1000");
  }
  if (requested < current) {
    throw new Error(
      `exam capacity cannot decrease during a run (current=${current})`,
    );
  }
}
