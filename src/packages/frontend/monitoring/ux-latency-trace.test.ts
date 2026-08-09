import {
  classifyUxTraceStaleReason,
  isDiagnosticUxMetric,
  shouldSampleUxTrace,
} from "./ux-latency-trace";

const BASE = {
  elapsed_ms: 1000,
  wall_elapsed_ms: 1000,
  stale_after_ms: 60_000,
  started_hidden: false,
  hidden_now: false,
  visibility_changed: false,
  surface_visible_at_start: true,
  surface_visible_at_end: true,
};

describe("classifyUxTraceStaleReason", () => {
  it("accepts an active foreground trace", () => {
    expect(classifyUxTraceStaleReason(BASE)).toBeUndefined();
  });

  it("classifies elapsed, suspension, and surface visibility separately", () => {
    expect(classifyUxTraceStaleReason({ ...BASE, elapsed_ms: 60_001 })).toBe(
      "elapsed_exceeded_cap",
    );
    expect(
      classifyUxTraceStaleReason({ ...BASE, wall_elapsed_ms: 12_000 }),
    ).toBe("wall_clock_skew");
    expect(
      classifyUxTraceStaleReason({
        ...BASE,
        surface_visible_at_start: false,
      }),
    ).toBe("surface_hidden_at_start");
    expect(
      classifyUxTraceStaleReason({ ...BASE, surface_visible_at_end: false }),
    ).toBe("surface_hidden_at_end");
  });

  it("classifies any page visibility transition as background work", () => {
    expect(
      classifyUxTraceStaleReason({ ...BASE, visibility_changed: true }),
    ).toBe("page_hidden");
  });
});

describe("UX trace sampling", () => {
  it("has stable per-trace decisions and honors boundary rates", () => {
    expect(shouldSampleUxTrace("trace-1", 0)).toBe(false);
    expect(shouldSampleUxTrace("trace-1", 1)).toBe(true);
    const decisions = Array.from({ length: 1000 }, (_, i) =>
      shouldSampleUxTrace(`trace-${i}`, 0.25),
    );
    expect(decisions.filter(Boolean).length).toBeGreaterThan(200);
    expect(decisions.filter(Boolean).length).toBeLessThan(300);
  });

  it("always recognizes diagnostic endpoints", () => {
    expect(isDiagnosticUxMetric("upload_failed_v2")).toBe(true);
    expect(isDiagnosticUxMetric("jupyter_open_incomplete_v2")).toBe(true);
    expect(isDiagnosticUxMetric("file_content_paint_v2_stale")).toBe(true);
    expect(isDiagnosticUxMetric("file_content_paint_v2")).toBe(false);
  });
});
