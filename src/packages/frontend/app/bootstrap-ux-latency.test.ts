/** @jest-environment jsdom */

const mockRecord = jest.fn();
const mockMark = jest.fn();
const mockMarkAt = jest.fn();

jest.mock("@cocalc/frontend/monitoring/ux-latency-trace", () => ({
  afterNextPaint: (callback: () => void) => {
    callback();
    return jest.fn();
  },
  UxLatencyTrace: class {
    mark = mockMark;
    markAt = mockMarkAt;
    record = mockRecord;
  },
}));

describe("signed-in bootstrap terminal outcome", () => {
  beforeEach(() => {
    jest.resetModules();
    mockRecord.mockReset();
    mockMark.mockReset();
    mockMarkAt.mockReset();
  });

  function installPreAppTrace() {
    const complete = jest.fn();
    (globalThis as any).__COCALC_STARTUP_TRACE__ = {
      complete,
      mark: jest.fn(),
      snapshot: () => ({
        id: "startup-test",
        started_at: new Date(0).toISOString(),
        marks: {},
        details: {},
      }),
    };
    return complete;
  }

  afterEach(() => {
    delete (globalThis as any).__COCALC_STARTUP_TRACE__;
  });

  it("does not complete abandonment monitoring at app-shell readiness", async () => {
    const complete = installPreAppTrace();
    const { recordSignedInAppBootstrapReady } =
      await import("./bootstrap-ux-latency");

    recordSignedInAppBootstrapReady();

    expect(complete).not.toHaveBeenCalled();
  });

  it("completes abandonment monitoring at useful-surface readiness", async () => {
    const complete = installPreAppTrace();
    const { recordSignedInSurfaceReady } =
      await import("./bootstrap-ux-latency");

    recordSignedInSurfaceReady("projects");

    expect(complete).toHaveBeenCalledWith("signed_in_surface_ready");
  });

  it("terminates incomplete monitoring after a reported failure", async () => {
    const complete = installPreAppTrace();
    const { recordAppBootstrapFailed } = await import("./bootstrap-ux-latency");

    recordAppBootstrapFailed("route_chunk", "ChunkLoadError");

    expect(complete).toHaveBeenCalledWith("app_bootstrap_failed");
  });
});
