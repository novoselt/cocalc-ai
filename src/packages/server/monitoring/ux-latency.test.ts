/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { PROJECT_DISK_QUOTA_EXCEEDED_CODE } from "@cocalc/util/project-start-errors";
import { classifyProjectStartQuotaTelemetry } from "./ux-latency";

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
