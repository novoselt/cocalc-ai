/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  parseCpuUsageUsec,
  parseIoFullPressureUsec,
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
    expect(
      parseIoFullPressureUsec(
        "some avg10=2.00 total=100\nfull avg10=1.00 total=4567\n",
      ),
    ).toBe(4567);
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
      io_full_pressure_usec: 0,
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

  it("attributes full I/O pressure to each project", () => {
    const tracker = new ProjectWorkloadActivityTracker({
      protectionMs: 60_000,
      activeCpuCores: 0.05,
      activeBytesPerSecond: 64 * 1024,
      activeOperationsPerSecond: 1,
    });
    tracker.update(
      [
        {
          project_id: "writer",
          sampled_at_ms: 0,
          cpu_usage_usec: 0,
          io_bytes: 0,
          io_operations: 0,
          io_full_pressure_usec: 0,
        },
      ],
      0,
    );
    tracker.update(
      [
        {
          project_id: "writer",
          sampled_at_ms: 10_000,
          cpu_usage_usec: 500_000,
          io_bytes: 10 * 1024 * 1024,
          io_operations: 3_000,
          io_full_pressure_usec: 6_000_000,
        },
      ],
      10_000,
    );
    expect(tracker.ratesByProject().get("writer")).toEqual({
      cpu_cores: 0.05,
      io_bytes_per_second: 1024 * 1024,
      io_operations_per_second: 300,
      io_full_pressure_percent: 60,
    });
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
