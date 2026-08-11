/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { hostSaturationFromRow } from "./ux-saturation";

describe("UX saturation host snapshots", () => {
  it("keeps bounded load, storage, and persistence measurements", () => {
    const observedAt = Date.parse("2026-08-08T08:01:30.000Z");
    const result = hostSaturationFromRow({
      observed_at_ms: observedAt,
      row: {
        host_id: "00000000-0000-4000-8000-000000000001",
        explicit_host_id: true,
        collected_at: "2026-08-08T08:01:00.000Z",
        cpu_percent: 72.345,
        load_1: 8.25,
        memory_used_percent: 81.246,
        swap_total_bytes: 1000,
        swap_used_bytes: 250,
        disk_device_total_bytes: 10_000,
        disk_device_used_bytes: 6000,
        shared_scratch_total_bytes: 2000,
        shared_scratch_used_bytes: 1000,
        running_project_count: 123,
        io_containment: {
          policy_mode: "observe",
          pressure_some_percent: 4.567,
          top_projects: [{ project_id: "must-not-leak" }],
        },
        conat_persist: {
          available: true,
          rss_bytes: 1_234_567,
          open_streams: 456,
          server_id: "must-not-leak",
        },
      },
    });
    expect(result.host_id).toBe("00000000-0000-4000-8000-000000000001");
    expect(result.details).toEqual(
      expect.objectContaining({
        available: true,
        resolution: "event",
        sample_age_ms: 30_000,
        stale: false,
        cpu_percent: 72.35,
        memory_used_percent: 81.25,
        swap_used_percent: 25,
        disk_device_used_percent: 60,
        shared_scratch_used_percent: 50,
        running_project_count: 123,
        io_containment: expect.objectContaining({
          policy_mode: "observe",
          pressure_some_percent: 4.57,
        }),
        conat_persist: expect.objectContaining({
          available: true,
          rss_bytes: 1_234_567,
          open_streams: 456,
        }),
      }),
    );
    expect(JSON.stringify(result.details)).not.toContain("must-not-leak");
  });

  it("marks old samples stale and reports hosts with no sample", () => {
    const observedAt = Date.parse("2026-08-08T08:10:00.000Z");
    expect(
      hostSaturationFromRow({
        observed_at_ms: observedAt,
        row: {
          host_id: "00000000-0000-4000-8000-000000000001",
          explicit_host_id: false,
          collected_at: "2026-08-08T08:00:00.000Z",
        },
      }).details,
    ).toEqual(
      expect.objectContaining({
        resolution: "project_projection",
        stale: true,
      }),
    );
    expect(
      hostSaturationFromRow({
        observed_at_ms: observedAt,
        row: {
          host_id: "00000000-0000-4000-8000-000000000001",
          explicit_host_id: false,
        },
      }).details,
    ).toEqual(
      expect.objectContaining({
        available: false,
        reason: "no_metrics_sample",
      }),
    );
  });
});
