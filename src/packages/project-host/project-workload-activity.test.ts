/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  parseCpuUsageUsec,
  parseIoTotals,
  ProjectWorkloadActivityTracker,
  type ProjectWorkloadSample,
} from "./project-workload-activity";

describe("project workload activity", () => {
  it("parses cgroup CPU and I/O counters", () => {
    expect(parseCpuUsageUsec("usage_usec 12345\nuser_usec 12000\n")).toBe(
      12345,
    );
    expect(
      parseIoTotals(
        "8:16 rbytes=4096 wbytes=8192 rios=1 wios=2\n8:32 rbytes=512 wbytes=1024 rios=3 wios=4\n",
      ),
    ).toEqual({ bytes: 13_824, operations: 10 });
  });

  it("protects new, active, and recently active workloads", () => {
    const tracker = new ProjectWorkloadActivityTracker({
      protectionMs: 60_000,
      activeCpuCores: 0.05,
      activeBytesPerSecond: 64 * 1024,
      activeOperationsPerSecond: 1,
    });
    const sample = (
      project_id: string,
      sampled_at_ms: number,
      cpu_usage_usec: number,
      io_bytes: number,
      io_operations: number,
    ): ProjectWorkloadSample => ({
      project_id,
      sampled_at_ms,
      cpu_usage_usec,
      io_bytes,
      io_operations,
    });

    expect(tracker.update([sample("idle", 0, 0, 0, 0)], 0)).toEqual(
      new Set(["idle"]),
    );
    expect(
      tracker.update([sample("idle", 30_000, 10_000, 1024, 0)], 30_000),
    ).toEqual(new Set(["idle"]));
    expect(
      tracker.update([sample("idle", 61_000, 20_000, 2048, 0)], 61_000),
    ).toEqual(new Set());

    expect(
      tracker.update([sample("idle", 71_000, 1_020_000, 2048, 0)], 71_000),
    ).toEqual(new Set(["idle"]));
    expect(
      tracker.update([sample("idle", 141_000, 1_030_000, 2048, 0)], 141_000),
    ).toEqual(new Set());
  });

  it("fails closed when a workload counter cannot be sampled", () => {
    const tracker = new ProjectWorkloadActivityTracker({
      protectionMs: 60_000,
      activeCpuCores: 0.05,
      activeBytesPerSecond: 64 * 1024,
      activeOperationsPerSecond: 1,
    });
    expect(
      tracker.update([{ project_id: "unknown", sampled_at_ms: 0 }], 0),
    ).toEqual(new Set(["unknown"]));
    expect(
      tracker.update(
        [{ project_id: "unknown", sampled_at_ms: 70_000 }],
        70_000,
      ),
    ).toEqual(new Set(["unknown"]));
  });
});
