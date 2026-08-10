const recordUxLatencyEventMock = jest.fn();

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    conat_client: {
      hub: {
        system: {
          recordUxLatencyEvent: (...args: any[]) =>
            recordUxLatencyEventMock(...args),
        },
      },
    },
  },
}));

import {
  configureUxLatency,
  getLightweightUxSuccessSampleRate,
  recordUxLatencyEvent,
  resetUxLatencyConfigurationForTests,
} from "./ux-latency";

describe("UX latency configuration", () => {
  beforeEach(() => {
    recordUxLatencyEventMock.mockReset().mockResolvedValue(undefined);
    resetUxLatencyConfigurationForTests();
  });

  it("clamps the lightweight success sample rate", () => {
    configureUxLatency({ success_sample_rate: 2 });
    expect(getLightweightUxSuccessSampleRate()).toBe(1);
    configureUxLatency({ success_sample_rate: -1 });
    expect(getLightweightUxSuccessSampleRate()).toBe(0);
  });

  it("drops events when the site-wide switch is disabled", () => {
    configureUxLatency({ telemetry_enabled: false });
    recordUxLatencyEvent({
      event_type: "test",
      metric: "test_ready",
      duration_ms: 1,
    });
    expect(recordUxLatencyEventMock).not.toHaveBeenCalled();
  });

  it("holds bootstrap events until the site switch is known", () => {
    recordUxLatencyEvent({
      event_type: "test",
      metric: "bootstrap_failed",
      duration_ms: 1,
    });
    expect(recordUxLatencyEventMock).not.toHaveBeenCalled();

    configureUxLatency({ telemetry_enabled: true });
    expect(recordUxLatencyEventMock).toHaveBeenCalledWith({
      event: expect.objectContaining({ metric: "bootstrap_failed" }),
    });
  });

  it("discards held bootstrap events when telemetry is disabled", () => {
    recordUxLatencyEvent({
      event_type: "test",
      metric: "bootstrap_failed",
      duration_ms: 1,
    });
    configureUxLatency({ telemetry_enabled: false });
    expect(recordUxLatencyEventMock).not.toHaveBeenCalled();
  });

  it("keeps recording asynchronous and best effort", () => {
    configureUxLatency({ telemetry_enabled: true });
    recordUxLatencyEvent({
      event_type: "test",
      metric: "test_ready",
      duration_ms: 1,
    });
    expect(recordUxLatencyEventMock).toHaveBeenCalledWith({
      event: expect.objectContaining({ metric: "test_ready" }),
    });
  });
});
