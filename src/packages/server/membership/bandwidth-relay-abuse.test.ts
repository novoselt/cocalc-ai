/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const getClusterAccountByIdMock = jest.fn();
const banClusterAccountAndEquivalentEmailsMock = jest.fn();
const resolveMembershipForAccountMock = jest.fn();
const getManagedEgressCategoryUsageForAccountMock = jest.fn();
const getProjectOwnerAccountIdMock = jest.fn();
const getProjectUserAccountIdsMock = jest.fn();
const getServerSettingsMock = jest.fn();

jest.mock("@cocalc/server/inter-bay/accounts", () => ({
  __esModule: true,
  getClusterAccountById: (...args: any[]) => getClusterAccountByIdMock(...args),
  banClusterAccountAndEquivalentEmails: (...args: any[]) =>
    banClusterAccountAndEquivalentEmailsMock(...args),
}));

jest.mock("./resolve", () => ({
  __esModule: true,
  resolveMembershipForAccount: (...args: any[]) =>
    resolveMembershipForAccountMock(...args),
}));

jest.mock("./managed-egress", () => ({
  __esModule: true,
  getManagedEgressCategoryUsageForAccount: (...args: any[]) =>
    getManagedEgressCategoryUsageForAccountMock(...args),
}));

jest.mock("./project-usage", () => ({
  __esModule: true,
  getProjectOwnerAccountId: (...args: any[]) =>
    getProjectOwnerAccountIdMock(...args),
  getProjectUserAccountIds: (...args: any[]) =>
    getProjectUserAccountIdsMock(...args),
}));

jest.mock("@cocalc/database/settings/server-settings", () => ({
  __esModule: true,
  getServerSettings: (...args: any[]) => getServerSettingsMock(...args),
}));

import type { ProjectBandwidthRelayEvidence } from "@cocalc/conat/hub/api/system";
import {
  handleProjectBandwidthRelayEvidence,
  sanitizeBandwidthRelayEvidenceMetadata,
} from "./bandwidth-relay-abuse";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const PROJECT_ID = "22222222-2222-4222-8222-222222222222";
const NOW = new Date("2026-08-10T12:00:00.000Z");
const GIB = 1024 ** 3;

const EVIDENCE: ProjectBandwidthRelayEvidence = {
  confidence: "high",
  detector_version: "test",
  detected_at: NOW.toISOString(),
  signals: [
    {
      kind: "tunnel_process",
      pattern: "cloudflared-tunnel",
      matched: "cloudflared tunnel",
    },
    {
      kind: "automated_uploader_process",
      pattern: "automated-uploader-script",
      matched: "uploader_bot/bot.py",
    },
  ],
};

describe("bandwidth relay abuse policy", () => {
  const originalRawNetwork5h =
    process.env.COCALC_BANDWIDTH_RELAY_ABUSE_RAW_NETWORK_5H_BYTES;
  const originalRawNetwork7d =
    process.env.COCALC_BANDWIDTH_RELAY_ABUSE_RAW_NETWORK_7D_BYTES;
  const originalAccountMaxAge =
    process.env.COCALC_BANDWIDTH_RELAY_AUTO_BAN_ACCOUNT_MAX_AGE_MS;

  beforeEach(() => {
    getClusterAccountByIdMock.mockReset().mockResolvedValue({
      account_id: ACCOUNT_ID,
      created: NOW.getTime() - 60_000,
      banned: false,
    });
    resolveMembershipForAccountMock.mockReset().mockResolvedValue({
      class: "free",
      source: "free",
      entitlements: {},
    });
    getProjectOwnerAccountIdMock.mockReset().mockResolvedValue(ACCOUNT_ID);
    getProjectUserAccountIdsMock.mockReset().mockResolvedValue([ACCOUNT_ID]);
    getManagedEgressCategoryUsageForAccountMock.mockReset().mockResolvedValue({
      bytes_5h: 2 * GIB,
      bytes_7d: 2 * GIB,
    });
    banClusterAccountAndEquivalentEmailsMock
      .mockReset()
      .mockResolvedValue([{ account_id: ACCOUNT_ID, banned: true }]);
    getServerSettingsMock.mockReset().mockResolvedValue({
      bandwidth_relay_abuse_enforcement_enabled: true,
      bandwidth_relay_abuse_auto_ban_enabled: true,
    });
    delete process.env.COCALC_BANDWIDTH_RELAY_ABUSE_RAW_NETWORK_5H_BYTES;
    delete process.env.COCALC_BANDWIDTH_RELAY_ABUSE_RAW_NETWORK_7D_BYTES;
    delete process.env.COCALC_BANDWIDTH_RELAY_AUTO_BAN_ACCOUNT_MAX_AGE_MS;
  });

  afterAll(() => {
    const restore = (name: string, value: string | undefined) => {
      if (value == null) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    };
    restore(
      "COCALC_BANDWIDTH_RELAY_ABUSE_RAW_NETWORK_5H_BYTES",
      originalRawNetwork5h,
    );
    restore(
      "COCALC_BANDWIDTH_RELAY_ABUSE_RAW_NETWORK_7D_BYTES",
      originalRawNetwork7d,
    );
    restore(
      "COCALC_BANDWIDTH_RELAY_AUTO_BAN_ACCOUNT_MAX_AGE_MS",
      originalAccountMaxAge,
    );
  });

  it("does nothing when site enforcement is disabled", async () => {
    getServerSettingsMock.mockResolvedValueOnce({});

    await expect(
      handleProjectBandwidthRelayEvidence({
        account_id: ACCOUNT_ID,
        project_id: PROJECT_ID,
        evidence: EVIDENCE,
        now: NOW,
      }),
    ).resolves.toEqual({ should_stop_project: false, auto_banned: false });
    expect(getManagedEgressCategoryUsageForAccountMock).not.toHaveBeenCalled();
  });

  it("requires extreme raw-network egress in addition to runtime evidence", async () => {
    getManagedEgressCategoryUsageForAccountMock.mockResolvedValueOnce({
      bytes_5h: GIB - 1,
      bytes_7d: 3 * GIB - 1,
    });

    const decision = await handleProjectBandwidthRelayEvidence({
      account_id: ACCOUNT_ID,
      project_id: PROJECT_ID,
      evidence: EVIDENCE,
      now: NOW,
    });

    expect(decision).toMatchObject({
      should_stop_project: false,
      auto_banned: false,
    });
    expect(banClusterAccountAndEquivalentEmailsMock).not.toHaveBeenCalled();
  });

  it("auto-bans a new free owner after high-confidence evidence and egress", async () => {
    const decision = await handleProjectBandwidthRelayEvidence({
      account_id: ACCOUNT_ID,
      project_id: PROJECT_ID,
      evidence: EVIDENCE,
      now: NOW,
    });

    expect(decision).toMatchObject({
      should_stop_project: true,
      auto_banned: true,
      abuse_kind: "bandwidth_relay",
      account_owns_project: true,
      raw_network_bytes_5h: 2 * GIB,
    });
    expect(banClusterAccountAndEquivalentEmailsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: ACCOUNT_ID,
        actor_account_id: null,
        reason: "automatic high-confidence bandwidth relay detection",
        metadata: expect.objectContaining({
          automatic: true,
          abuse_kind: "bandwidth_relay",
          project_id: PROJECT_ID,
          evidence: EVIDENCE,
        }),
      }),
    );
  });

  it("stops but does not auto-ban paid accounts", async () => {
    resolveMembershipForAccountMock.mockResolvedValueOnce({
      class: "standard",
      source: "subscription",
      entitlements: {},
    });

    const decision = await handleProjectBandwidthRelayEvidence({
      account_id: ACCOUNT_ID,
      project_id: PROJECT_ID,
      evidence: EVIDENCE,
      now: NOW,
    });

    expect(decision).toMatchObject({
      should_stop_project: true,
      auto_banned: false,
      membership_class: "standard",
    });
    expect(banClusterAccountAndEquivalentEmailsMock).not.toHaveBeenCalled();
  });

  it("does not stop an account with an active relay abuse exemption", async () => {
    resolveMembershipForAccountMock.mockResolvedValueOnce({
      class: "standard",
      source: "subscription",
      entitlements: {
        features: { bandwidth_relay_abuse_exempt: true },
      },
    });

    const decision = await handleProjectBandwidthRelayEvidence({
      account_id: ACCOUNT_ID,
      project_id: PROJECT_ID,
      evidence: EVIDENCE,
      now: NOW,
    });

    expect(decision).toMatchObject({
      should_stop_project: false,
      auto_banned: false,
      account_exempt: true,
      membership_class: "standard",
    });
    expect(banClusterAccountAndEquivalentEmailsMock).not.toHaveBeenCalled();
  });

  it("does not auto-ban a sponsor that does not own the project", async () => {
    getProjectOwnerAccountIdMock.mockResolvedValueOnce(
      "33333333-3333-4333-8333-333333333333",
    );

    const decision = await handleProjectBandwidthRelayEvidence({
      account_id: ACCOUNT_ID,
      project_id: PROJECT_ID,
      evidence: EVIDENCE,
      now: NOW,
    });

    expect(decision).toMatchObject({
      should_stop_project: true,
      auto_banned: false,
      account_owns_project: false,
    });
    expect(banClusterAccountAndEquivalentEmailsMock).not.toHaveBeenCalled();
  });

  it("does not auto-ban an owner when another collaborator could be responsible", async () => {
    getProjectUserAccountIdsMock.mockResolvedValueOnce([
      ACCOUNT_ID,
      "33333333-3333-4333-8333-333333333333",
    ]);

    const decision = await handleProjectBandwidthRelayEvidence({
      account_id: ACCOUNT_ID,
      project_id: PROJECT_ID,
      evidence: EVIDENCE,
      now: NOW,
    });

    expect(decision).toMatchObject({
      should_stop_project: true,
      auto_banned: false,
      account_owns_project: true,
      account_is_sole_project_user: false,
    });
    expect(banClusterAccountAndEquivalentEmailsMock).not.toHaveBeenCalled();
  });

  it("ignores generic tunnel plus bulk-transfer tooling", async () => {
    const decision = await handleProjectBandwidthRelayEvidence({
      account_id: ACCOUNT_ID,
      project_id: PROJECT_ID,
      evidence: {
        ...EVIDENCE,
        signals: [
          EVIDENCE.signals[0],
          {
            kind: "bulk_transfer_process",
            pattern: "rclone-bulk-transfer",
            matched: "rclone",
          },
        ],
      },
      now: NOW,
    });

    expect(decision).toMatchObject({
      should_stop_project: false,
      auto_banned: false,
    });
    expect(getManagedEgressCategoryUsageForAccountMock).not.toHaveBeenCalled();
    expect(banClusterAccountAndEquivalentEmailsMock).not.toHaveBeenCalled();
  });

  it("does not auto-ban older free accounts", async () => {
    getClusterAccountByIdMock.mockResolvedValueOnce({
      account_id: ACCOUNT_ID,
      created: NOW.getTime() - 30 * 24 * 60 * 60 * 1000,
      banned: false,
    });

    const decision = await handleProjectBandwidthRelayEvidence({
      account_id: ACCOUNT_ID,
      project_id: PROJECT_ID,
      evidence: EVIDENCE,
      now: NOW,
    });

    expect(decision).toMatchObject({
      should_stop_project: true,
      auto_banned: false,
    });
    expect(banClusterAccountAndEquivalentEmailsMock).not.toHaveBeenCalled();
  });

  it("strips evidence from stored metadata when enforcement is disabled", () => {
    expect(
      sanitizeBandwidthRelayEvidenceMetadata({
        enforcement_enabled: false,
        metadata: {
          mode: "residual-v1",
          bandwidth_relay_evidence: EVIDENCE,
        },
      }),
    ).toEqual({ mode: "residual-v1" });
  });
});
