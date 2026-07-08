/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { _test, classifyHostAvailabilitySnapshot } from "./availability";

describe("classifyHostAvailabilitySnapshot", () => {
  it("treats a healthy standard fallback host as online", () => {
    const observation = classifyHostAvailabilitySnapshot({
      id: "dab25958-64df-4bea-803b-77319d7839f6",
      status: "running",
      last_seen: new Date().toISOString(),
      metadata: {
        desired_state: "running",
        spot_recovery_state: {
          phase: "running_standard_fallback",
        },
      },
    });

    expect(observation.state).toBe("online");
    expect(observation.planned).toBe(false);
    expect(observation.category).toBe("unknown");
    expect(observation.summary).toBe("Host is online on standard fallback.");
  });

  it("treats a healthy fallback host as online while probing spot capacity", () => {
    const observation = classifyHostAvailabilitySnapshot({
      id: "dab25958-64df-4bea-803b-77319d7839f6",
      status: "running",
      last_seen: new Date().toISOString(),
      metadata: {
        desired_state: "running",
        spot_recovery_state: {
          phase: "probing_spot",
        },
      },
    });

    expect(observation.state).toBe("online");
    expect(observation.summary).toBe("Host is online on standard fallback.");
  });

  it("keeps active spot retry as recovering", () => {
    const observation = classifyHostAvailabilitySnapshot({
      id: "dab25958-64df-4bea-803b-77319d7839f6",
      status: "starting",
      metadata: {
        desired_state: "running",
        spot_recovery_state: {
          phase: "retrying_spot",
        },
      },
    });

    expect(observation.state).toBe("recovering");
    expect(observation.category).toBe("spot_interruption");
  });

  it("treats a running host with stale heartbeats as unavailable", () => {
    const observation = classifyHostAvailabilitySnapshot({
      id: "12869982-da11-495e-9914-ee784ee8d5a8",
      status: "running",
      last_seen: new Date(Date.now() - 11 * 60_000).toISOString(),
      metadata: {
        desired_state: "running",
      },
    });

    expect(observation.state).toBe("unavailable");
    expect(observation.planned).toBe(false);
    expect(observation.category).toBe("host_stale");
    expect(observation.summary).toBe(
      "Host is running at the provider but not reporting.",
    );
  });

  it("formats running-but-stale host alert bodies", () => {
    expect(_test.formatStaleDuration(125 * 60_000)).toBe("2h5m");
    const body = _test.formatRunningStaleHostAlertBody([
      {
        id: "12869982-da11-495e-9914-ee784ee8d5a8",
        status: "running",
        stale_ms: 6 * 60_000,
        metadata: { name: "montreal-1" },
        public_url:
          "https://host-12869982-da11-495e-9914-ee784ee8d5a8.cocalc.ai",
      },
    ]);
    expect(body).toContain("montreal-1");
    expect(body).toContain("stale>=5m");
    expect(body).not.toContain("stale>=6m");
  });

  it("identifies host pressure states that need admin attention", () => {
    const row = _test.pressureAlertRow({
      id: "246d760c-c160-46ee-a749-08a623f39d5e",
      status: "running",
      metadata: {
        name: "asia-1",
        pressure: {
          zone: "emergency",
          last_action_status: "no_candidates",
          last_action_reason: "memory_available_bytes<=2147483648",
        },
      },
    });

    expect(row).toMatchObject({
      pressure_zone: "emergency",
      pressure_action_status: "no_candidates",
      pressure_reason: "memory_available_bytes<=2147483648",
    });
    expect(_test.formatHostPressureAlertBody([row!])).toContain("asia-1");
  });

  it("ignores healthy pressure states", () => {
    expect(
      _test.pressureAlertRow({
        id: "healthy-host",
        status: "running",
        metadata: {
          pressure: {
            zone: "observe",
            last_action_status: "cooldown",
          },
        },
      }),
    ).toBeUndefined();
    expect(
      _test.pressureAlertRow({
        id: "normal-host",
        status: "running",
        metadata: {
          pressure: {
            zone: "normal",
          },
        },
      }),
    ).toBeUndefined();
  });

  it("keeps running-but-stale alert bodies stable as staleness grows", () => {
    expect(
      _test.formatRunningStaleHostAlertBody([
        {
          id: "12869982-da11-495e-9914-ee784ee8d5a8",
          status: "running",
          stale_ms: 6 * 60_000,
          metadata: { name: "montreal-1" },
          public_url:
            "https://host-12869982-da11-495e-9914-ee784ee8d5a8.cocalc.ai",
        },
      ]),
    ).toEqual(
      _test.formatRunningStaleHostAlertBody([
        {
          id: "12869982-da11-495e-9914-ee784ee8d5a8",
          status: "running",
          stale_ms: 90 * 60_000,
          metadata: { name: "montreal-1" },
          public_url:
            "https://host-12869982-da11-495e-9914-ee784ee8d5a8.cocalc.ai",
        },
      ]),
    );
  });
});
