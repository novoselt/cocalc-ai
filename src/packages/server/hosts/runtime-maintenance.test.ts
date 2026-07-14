/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { _test } from "./runtime-maintenance";

const NOW = Date.UTC(2026, 6, 14, 12, 0, 0);

function degradedCloudHost(overrides: Record<string, any> = {}) {
  return {
    id: "dab25958-64df-4bea-803b-77319d7839f6",
    name: "western-europe-1",
    status: "running",
    last_seen: new Date(NOW - 10_000),
    metadata: {
      desired_state: "running",
      host_boot_id: "boot-3",
      host_session_id: "session-3",
      machine: { cloud: "gcp" },
      runtime_health: {
        status: "degraded",
        ready: false,
        consecutive_failures: 3,
        diagnostics_completed_at: new Date(NOW - 60_000).toISOString(),
        error: "podman ps timed out",
      },
      ...overrides,
    },
  };
}

describe("project-host runtime maintenance policy", () => {
  it("requires completed forensic capture before rebooting", () => {
    const row = degradedCloudHost();
    delete row.metadata.runtime_health.diagnostics_completed_at;
    expect(_test.autoRebootDecision(row, NOW)).toEqual({
      action: "wait",
      reason: "forensic capture is not complete",
    });
  });

  it("allows a bounded reboot after repeated runtime failures", () => {
    expect(_test.autoRebootDecision(degradedCloudHost(), NOW)).toEqual({
      action: "reboot",
      attempts: [],
    });
  });

  it("exhausts the rolling reboot budget", () => {
    const attempts = [
      {
        at: new Date(NOW - 5 * 60_000).toISOString(),
        host_boot_id: "boot-2",
      },
      {
        at: new Date(NOW - 2 * 60_000).toISOString(),
        host_boot_id: "boot-3",
      },
    ];
    expect(
      _test.autoRebootDecision(
        degradedCloudHost({ runtime_auto_recovery: { attempts } }),
        NOW,
      ),
    ).toEqual({ action: "exhausted", attempts });
  });

  it("does not automatically reboot local or stale hosts", () => {
    expect(
      _test.autoRebootDecision(
        degradedCloudHost({ machine: { cloud: "local" } }),
        NOW,
      ),
    ).toMatchObject({ action: "wait", reason: "host is not cloud-backed" });
    expect(
      _test.autoRebootDecision(
        { ...degradedCloudHost(), last_seen: new Date(NOW - 3 * 60_000) },
        NOW,
      ),
    ).toMatchObject({ action: "wait", reason: "host heartbeat is stale" });
  });

  it("runs a new synthetic probe after a boot or the success interval", () => {
    const row = degradedCloudHost({
      host_boot_id: "boot-4",
      runtime_synthetic_probe: {
        status: "passed",
        host_boot_id: "boot-3",
        checked_at: new Date(NOW - 60_000).toISOString(),
      },
    });
    expect(_test.syntheticProbeDue(row, NOW)).toBe(true);

    row.metadata.runtime_synthetic_probe.host_boot_id = "boot-4";
    row.metadata.runtime_synthetic_probe.checked_at = new Date(
      NOW - 31 * 60_000,
    ).toISOString();
    expect(_test.syntheticProbeDue(row, NOW)).toBe(true);
    row.metadata.runtime_synthetic_probe.checked_at = new Date(
      NOW - 5 * 60_000,
    ).toISOString();
    expect(_test.syntheticProbeDue(row, NOW)).toBe(false);
  });
});
