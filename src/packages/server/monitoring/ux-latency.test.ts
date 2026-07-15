/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { PROJECT_DISK_QUOTA_EXCEEDED_CODE } from "@cocalc/util/project-start-errors";
import type {
  UxLatencyMetricSummary,
  UxLatencySummary,
} from "@cocalc/conat/hub/api/system";
import {
  alertCandidates,
  classifyProjectStartQuotaTelemetry,
  DEFAULT_UX_LATENCY_SLA_THRESHOLDS,
} from "./ux-latency";

const event = {
  event_type: "project_start",
  metric: "project_start_running_stuck",
  duration_ms: 60_000,
  details: { op_id: "00000000-0000-4000-8000-000000000001" },
};

describe("project start quota telemetry", () => {
  it("reclassifies a stale stuck event after a quota-blocked LRO fails", () => {
    const classified = classifyProjectStartQuotaTelemetry({
      event,
      lro: {
        status: "failed",
        error: "Project disk quota exceeded",
        result: {
          project_start_failure: {
            code: PROJECT_DISK_QUOTA_EXCEEDED_CODE,
          },
        },
      },
    });
    expect(classified.metric).toBe("project_start_running_blocked");
    expect(classified.details).toEqual(
      expect.objectContaining({
        original_metric: "project_start_running_stuck",
        op_status: "failed",
      }),
    );
  });

  it("preserves genuine stalls and unrelated failures", () => {
    expect(
      classifyProjectStartQuotaTelemetry({
        event,
        lro: { status: "running", error: null, result: null },
      }),
    ).toBe(event);
    expect(
      classifyProjectStartQuotaTelemetry({
        event,
        lro: {
          status: "failed",
          error: "host unavailable",
          result: null,
        },
      }),
    ).toBe(event);
  });
});

function metric({
  segment,
  count = 30,
  p95_ms,
}: {
  segment?: string;
  count?: number;
  p95_ms: number;
}): UxLatencyMetricSummary {
  return {
    metric: "project_exec_ready",
    event_type: "project_ready",
    segment,
    count,
    avg_ms: p95_ms,
    p50_ms: 0,
    p95_ms,
    p99_ms: p95_ms,
    max_ms: p95_ms,
  };
}

function summary({
  aggregate,
  warm,
  autostart,
}: {
  aggregate: UxLatencyMetricSummary;
  warm?: UxLatencyMetricSummary;
  autostart?: UxLatencyMetricSummary;
}): UxLatencySummary {
  const recent_slow_events = Array.from({ length: 3 }, (_, index) => ({
    received_at: `2026-07-15T22:30:0${index}.000Z`,
    event_type: "project_ready",
    metric: "project_exec_ready",
    segment: warm?.segment ?? autostart?.segment,
    duration_ms: warm?.p95_ms ?? autostart?.p95_ms ?? aggregate.p95_ms,
  }));
  return {
    checked_at: "2026-07-15T22:31:00.000Z",
    window_minutes: 15,
    since: "2026-07-15T22:16:00.000Z",
    metrics: [aggregate],
    segments: [warm, autostart].filter(
      (row): row is UxLatencyMetricSummary => row != null,
    ),
    recent_slow_events,
  };
}

describe("project exec readiness alerts", () => {
  const sla = {
    ...DEFAULT_UX_LATENCY_SLA_THRESHOLDS,
    project_exec_ready_p95_ms: 15_000,
  };

  it("does not page on stale autostart streams", () => {
    const autostart = metric({ segment: "autostart", p95_ms: 24_017_000 });
    const alerts = alertCandidates(
      summary({ aggregate: metric({ p95_ms: 11_855_000 }), autostart }),
      sla,
    );
    expect(alerts).toEqual([]);
  });

  it("pages when already-running project execs violate the SLA", () => {
    const warm = metric({ segment: "warm", p95_ms: 20_000 });
    const alerts = alertCandidates(
      summary({ aggregate: metric({ p95_ms: 20_000 }), warm }),
      sla,
    );
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toEqual(
      expect.objectContaining({
        subject: "project exec ready latency is high",
      }),
    );
    expect(alerts[0].body).toContain("Segment: warm");
  });
});
