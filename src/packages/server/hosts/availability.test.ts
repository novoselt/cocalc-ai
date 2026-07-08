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
    ).toContain("montreal-1");
  });
});
