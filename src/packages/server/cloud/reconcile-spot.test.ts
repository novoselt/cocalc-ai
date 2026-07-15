import {
  maxStandardRuntimeMs,
  normalizeSpotRecoveryPolicy,
  normalizeSpotRecoveryState,
  shouldAutoRestoreInterruptedSpotHost,
} from "./spot-restore";

describe("spot recovery metadata", () => {
  it("bounds fallback runtime to 24 hours by default", () => {
    expect(maxStandardRuntimeMs({})).toBe(24 * 60 * 60 * 1000);
  });

  it("advances from a repeatedly interrupted Spot machine type by default", () => {
    expect(
      normalizeSpotRecoveryPolicy({})?.max_restore_attempts_before_fallback,
    ).toBe(2);
  });

  it("normalizes configured alternate machine types", () => {
    expect(
      normalizeSpotRecoveryPolicy({
        alternate_spot_machine_types: [
          " n2d-standard-16 ",
          "n2d-standard-16",
          "",
        ],
      })?.alternate_spot_machine_types,
    ).toEqual(["n2d-standard-16"]);
  });

  it("preserves the active machine type and attempted candidates", () => {
    expect(
      normalizeSpotRecoveryState({
        phase: "retrying_spot",
        active_machine_type: "n2d-standard-16",
        machine_type_attempt_started_at: "2026-07-15T19:00:00.000Z",
        spot_machine_types_tried: [
          "t2d-standard-16",
          "n2d-standard-16",
          "n2d-standard-16",
        ],
      }),
    ).toMatchObject({
      active_machine_type: "n2d-standard-16",
      machine_type_attempt_started_at: "2026-07-15T19:00:00.000Z",
      spot_machine_types_tried: ["t2d-standard-16", "n2d-standard-16"],
    });
  });
});

describe("shouldAutoRestoreInterruptedSpotHost", () => {
  it("returns true for spot hosts with immediate restore", () => {
    expect(
      shouldAutoRestoreInterruptedSpotHost({
        id: "host-1",
        status: "running",
        metadata: {
          pricing_model: "spot",
          interruption_restore_policy: "immediate",
          desired_state: "running",
          last_action: "start",
          last_action_status: "success",
        },
      }),
    ).toBe(true);
  });

  it("returns false for explicitly stopped spot hosts", () => {
    expect(
      shouldAutoRestoreInterruptedSpotHost({
        id: "host-1",
        status: "off",
        metadata: {
          pricing_model: "spot",
          interruption_restore_policy: "immediate",
          desired_state: "stopped",
        },
      }),
    ).toBe(false);
  });

  it("returns false during intentional maintenance", () => {
    expect(
      shouldAutoRestoreInterruptedSpotHost({
        id: "host-1",
        status: "running",
        metadata: {
          pricing_model: "spot",
          interruption_restore_policy: "immediate",
          desired_state: "running",
          last_action: "upgrade_software",
          last_action_status: "pending",
        },
      }),
    ).toBe(false);
  });

  it("returns false when restore policy is disabled", () => {
    expect(
      shouldAutoRestoreInterruptedSpotHost({
        id: "host-1",
        status: "running",
        metadata: {
          pricing_model: "spot",
          interruption_restore_policy: "none",
        },
      }),
    ).toBe(false);
  });
});
