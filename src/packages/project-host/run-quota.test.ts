/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { runnerConfigFromQuota } from "./run-quota";

describe("runnerConfigFromQuota", () => {
  it("converts persisted membership quotas into runner limits", () => {
    expect(
      runnerConfigFromQuota({
        cpu_limit: 2,
        memory_limit: 4000,
        pids_limit: 123,
        disk_quota: 5000,
        gpu: true,
      }),
    ).toEqual(
      expect.objectContaining({
        cpu: 2,
        memory: 4_000_000_000,
        tmp: 2_000_000_000,
        swap: true,
        pids: 123,
        disk: 5_000_000_000,
        scratch: 5_000_000_000,
        gpu: true,
      }),
    );
  });

  it("accepts serialized quotas used by older local databases", () => {
    expect(
      runnerConfigFromQuota(JSON.stringify({ memory_limit: 2000 })),
    ).toEqual(expect.objectContaining({ memory: 2_000_000_000 }));
  });
});
