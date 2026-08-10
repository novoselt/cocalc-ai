/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export {};

const recordManagedProjectEgressMock = jest.fn();
const getProjectBandwidthRelayAbuseSettingsMock = jest.fn();
const handleProjectBandwidthRelayEvidenceMock = jest.fn();
const getAssignedProjectHostInfoMock = jest.fn();

jest.mock("@cocalc/server/membership/managed-egress", () => ({
  __esModule: true,
  recordManagedProjectEgress: (...args: any[]) =>
    recordManagedProjectEgressMock(...args),
}));

jest.mock("@cocalc/server/membership/bandwidth-relay-abuse", () => ({
  __esModule: true,
  getProjectBandwidthRelayAbuseSettings: (...args: any[]) =>
    getProjectBandwidthRelayAbuseSettingsMock(...args),
  handleProjectBandwidthRelayEvidence: (...args: any[]) =>
    handleProjectBandwidthRelayEvidenceMock(...args),
  sanitizeBandwidthRelayEvidenceMetadata: ({
    metadata,
    enforcement_enabled,
  }: {
    metadata?: Record<string, unknown>;
    enforcement_enabled: boolean;
  }) =>
    enforcement_enabled || !metadata
      ? metadata
      : Object.fromEntries(
          Object.entries(metadata).filter(
            ([key]) => key !== "bandwidth_relay_evidence",
          ),
        ),
}));

jest.mock("@cocalc/server/conat/project-host-assignment", () => ({
  __esModule: true,
  getAssignedProjectHostInfo: (...args: any[]) =>
    getAssignedProjectHostInfoMock(...args),
}));

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const HOST_ID = "22222222-2222-4222-8222-222222222222";
const ACCOUNT_ID = "33333333-3333-4333-8333-333333333333";
const EVIDENCE = {
  confidence: "high" as const,
  signals: [
    {
      kind: "tunnel_process" as const,
      pattern: "cloudflared-tunnel",
      matched: "cloudflared tunnel",
    },
    {
      kind: "automated_uploader_process" as const,
      pattern: "automated-uploader-script",
      matched: "uploader_bot/bot.py",
    },
  ],
};

describe("project-host abuse evidence authorization", () => {
  beforeEach(() => {
    recordManagedProjectEgressMock.mockReset().mockResolvedValue({
      recorded: true,
      account_id: ACCOUNT_ID,
    });
    getProjectBandwidthRelayAbuseSettingsMock.mockReset().mockResolvedValue({
      enforcement_enabled: true,
      auto_ban_enabled: true,
    });
    handleProjectBandwidthRelayEvidenceMock.mockReset().mockResolvedValue({
      should_stop_project: false,
      auto_banned: false,
    });
    getAssignedProjectHostInfoMock.mockReset().mockResolvedValue({
      host_id: HOST_ID,
    });
  });

  it("discards evidence supplied by a project-authenticated caller", async () => {
    const { recordManagedProjectEgress } = await import("./system");

    await recordManagedProjectEgress({
      project_id: PROJECT_ID,
      category: "raw-network",
      bytes: 1024,
      bandwidth_relay_evidence: EVIDENCE,
      metadata: {
        mode: "test",
        bandwidth_relay_evidence: EVIDENCE,
      },
    });

    expect(getProjectBandwidthRelayAbuseSettingsMock).not.toHaveBeenCalled();
    expect(recordManagedProjectEgressMock).toHaveBeenCalledWith({
      account_id: undefined,
      project_id: PROJECT_ID,
      category: "raw-network",
      bytes: 1024,
      metadata: { mode: "test" },
    });
    expect(handleProjectBandwidthRelayEvidenceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: ACCOUNT_ID,
        project_id: PROJECT_ID,
        evidence: undefined,
        settings: undefined,
      }),
    );
  });

  it("accepts evidence from the host assigned to the project", async () => {
    const { recordManagedProjectEgress } = await import("./system");

    await recordManagedProjectEgress({
      host_id: HOST_ID,
      project_id: PROJECT_ID,
      category: "raw-network",
      bytes: 1024,
      bandwidth_relay_evidence: EVIDENCE,
      metadata: { mode: "test" },
    });

    expect(getAssignedProjectHostInfoMock).toHaveBeenCalledWith(PROJECT_ID);
    expect(getProjectBandwidthRelayAbuseSettingsMock).toHaveBeenCalledTimes(1);
    expect(recordManagedProjectEgressMock).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: PROJECT_ID,
        metadata: {
          mode: "test",
          bandwidth_relay_evidence: EVIDENCE,
        },
      }),
    );
    expect(handleProjectBandwidthRelayEvidenceMock).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: ACCOUNT_ID,
        project_id: PROJECT_ID,
        evidence: EVIDENCE,
      }),
    );
  });
});
