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

  function installPreAppTrace(opts?: {
    marks?: Record<string, number>;
    phaseDetails?: Record<string, Record<string, number>>;
  }) {
    const complete = jest.fn();
    (globalThis as any).__COCALC_STARTUP_TRACE__ = {
      complete,
      mark: jest.fn(),
      snapshot: () => ({
        id: "startup-test",
        started_at: new Date(0).toISOString(),
        marks: opts?.marks ?? {},
        details: { phase_details: opts?.phaseDetails ?? {} },
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

  it("merges lifecycle phases recorded after the app trace was created", async () => {
    const marks = { account_snapshot_applied: 125 };
    installPreAppTrace({
      marks,
      phaseDetails: { account_snapshot_applied: { field_count: 4 } },
    });
    const { markAppBootstrapPhase, recordSignedInSurfaceReady } =
      await import("./bootstrap-ux-latency");
    markAppBootstrapPhase("render_called");
    marks.customize_ready = 250;

    recordSignedInSurfaceReady("projects");

    expect(mockMarkAt).toHaveBeenCalledWith("customize_ready", 250, undefined);
    expect(mockMarkAt).toHaveBeenCalledWith("account_snapshot_applied", 125, {
      field_count: 4,
    });
  });

  it("terminates incomplete monitoring after a reported failure", async () => {
    const complete = installPreAppTrace();
    const { recordAppBootstrapFailed } = await import("./bootstrap-ux-latency");

    recordAppBootstrapFailed("route_chunk", "ChunkLoadError");

    expect(complete).toHaveBeenCalledWith("app_bootstrap_failed");
  });
});
