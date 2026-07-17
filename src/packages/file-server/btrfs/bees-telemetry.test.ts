import {
  type BeesTelemetrySnapshot,
  updateBeesTelemetry,
} from "./bees-telemetry";

function sample({
  at,
  pid = 10,
  cpu = 0,
  block = 0,
  dedup = 0,
  crawl = "a",
}: {
  at: string;
  pid?: number | null;
  cpu?: number;
  block?: number;
  dedup?: number;
  crawl?: string;
}): BeesTelemetrySnapshot {
  return {
    sampled_at: at,
    pid,
    cgroup: { cpu_stat: { usage_usec: cpu } },
    stats: { total: { block_bytes: block, dedup_bytes: dedup } },
    crawl: { sha256: crawl },
  };
}

describe("BEES telemetry assessment", () => {
  it("distinguishes active scan progress from deduplication yield", () => {
    const first = updateBeesTelemetry(
      undefined,
      sample({ at: "2026-07-17T00:00:00Z" }),
    );
    const next = updateBeesTelemetry(
      first,
      sample({
        at: "2026-07-17T00:05:00Z",
        cpu: 600_000_000,
        block: 10_000,
        dedup: 0,
      }),
    );
    expect(next.assessment).toBe("active");
    expect(next.average_cpu_cores).toBe(2);
    expect(next.counter_delta).toMatchObject({
      block_bytes: 10_000,
      dedup_bytes: 0,
    });
  });

  it("requires sustained CPU without scan or checkpoint progress", () => {
    let status = updateBeesTelemetry(
      undefined,
      sample({ at: "2026-07-17T00:00:00Z" }),
    );
    status = updateBeesTelemetry(
      status,
      sample({ at: "2026-07-17T01:00:00Z", cpu: 7_200_000_000 }),
    );
    expect(status.assessment).toBe("observing");
    status = updateBeesTelemetry(
      status,
      sample({ at: "2026-07-17T01:31:00Z", cpu: 10_920_000_000 }),
    );
    expect(status.assessment).toBe("possible_stall");
    expect(status.progress_age_ms).toBe(91 * 60 * 1000);
  });

  it("treats low CPU as healthy idle and resets the observation window", () => {
    const first = updateBeesTelemetry(
      undefined,
      sample({ at: "2026-07-17T00:00:00Z" }),
    );
    const idle = updateBeesTelemetry(
      first,
      sample({ at: "2026-07-17T02:00:00Z", cpu: 1_000 }),
    );
    expect(idle.assessment).toBe("idle");
    expect(idle.last_progress_at).toBe("2026-07-17T02:00:00Z");
  });

  it("resets progress observation when the process changes", () => {
    const first = updateBeesTelemetry(
      undefined,
      sample({ at: "2026-07-17T00:00:00Z", pid: 10 }),
    );
    const restarted = updateBeesTelemetry(
      first,
      sample({ at: "2026-07-17T02:00:00Z", pid: 11, cpu: 100 }),
    );
    expect(restarted.assessment).toBe("observing");
    expect(restarted.interval_ms).toBeUndefined();
    expect(restarted.last_progress_at).toBe("2026-07-17T02:00:00Z");
  });
});
