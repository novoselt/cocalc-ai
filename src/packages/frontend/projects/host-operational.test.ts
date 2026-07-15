/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  getHostRecoveryDisplay,
  getProjectLifecycleView,
  normalizeProjectStateForDisplay,
} from "./host-operational";

describe("projects host operational display state", () => {
  it("describes automatic spot recovery with an alternate machine type", () => {
    expect(
      getHostRecoveryDisplay({
        desired_state: "running",
        desired_pricing_model: "spot",
        effective_pricing_model: "spot",
        recovery_phase: "retrying_spot",
        machine: { machine_type: "t2d-standard-16" },
        spot_recovery_state: {
          phase: "retrying_spot",
          active_machine_type: "n2d-standard-16",
        },
      }),
    ).toMatchObject({
      active: true,
      title: "Project host is restarting on alternate Spot capacity",
      etaMinutes: 2,
    });
  });

  it("does not describe idle spot hosts as recovering", () => {
    expect(
      getHostRecoveryDisplay({
        desired_state: "running",
        desired_pricing_model: "spot",
        recovery_phase: "idle",
      }),
    ).toEqual({ active: false });
  });

  it("keeps running projects running when host heartbeat is stale", () => {
    const hostInfo = {
      status: "running",
      last_seen: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
      reason_unavailable: "Host heartbeat is stale; host appears offline.",
    };

    expect(
      normalizeProjectStateForDisplay({
        projectState: "running",
        hostId: "host-1",
        hostInfo,
      }),
    ).toBe("running");
  });

  it("downgrades running projects when the host is explicitly off", () => {
    const hostInfo = {
      status: "off",
      last_seen: new Date().toISOString(),
      reason_unavailable: "Host is off; it must be running.",
    };

    expect(
      normalizeProjectStateForDisplay({
        projectState: "running",
        hostId: "host-1",
        hostInfo,
      }),
    ).toBe("opened");
  });

  it("keeps running projects running when host info is missing", () => {
    expect(
      normalizeProjectStateForDisplay({
        projectState: "running",
        hostId: "host-1",
        hostInfo: undefined,
      }),
    ).toBe("running");
  });

  it("classifies archived projects from indexed backups", () => {
    expect(
      getProjectLifecycleView({
        projectState: "archived",
        lastBackup: new Date().toISOString(),
      }),
    ).toMatchObject({
      kind: "archived",
      isArchived: true,
      isArchivedLike: true,
      canShowFilesystem: false,
    });
  });

  it("classifies new projects from missing indexed backups", () => {
    expect(
      getProjectLifecycleView({
        projectState: "archived",
        lastBackup: null,
      }),
    ).toMatchObject({
      kind: "new",
      isNew: true,
      isArchived: false,
      isArchivedLike: true,
      canShowFilesystem: false,
    });
  });

  it("keeps raw archived state authoritative while backup metadata loads", () => {
    expect(
      getProjectLifecycleView({
        projectState: "archived",
        lastBackup: undefined,
      }),
    ).toMatchObject({
      kind: "unknown",
      displayState: undefined,
      isRawArchived: true,
      isArchived: false,
      isArchivedLike: true,
    });
  });
});
