import {
  capturePageVisibility,
  classifyUxTraceStaleReason,
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

describe("capturePageVisibility", () => {
  it("shares one epoch that advances when the page becomes hidden", () => {
    const hidden = jest.spyOn(document, "hidden", "get");
    hidden.mockReturnValue(false);
    const before = capturePageVisibility();

    hidden.mockReturnValue(true);
    document.dispatchEvent(new Event("visibilitychange"));
    const after = capturePageVisibility();

    expect(before.page_hidden).toBe(false);
    expect(after).toEqual({
      page_hidden: true,
      visibility_epoch: before.visibility_epoch + 1,
    });
    hidden.mockRestore();
  });
});
