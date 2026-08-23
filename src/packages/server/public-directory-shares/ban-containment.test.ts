/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export {};

const disableForBannedActorMock = jest.fn();
const remoteDisableMock = jest.fn();

jest.mock("./index", () => ({
  disableForBannedActor: (...args: any[]) => disableForBannedActorMock(...args),
}));

jest.mock("@cocalc/server/bay-config", () => ({
  getConfiguredBayId: () => "bay-1",
}));

jest.mock("@cocalc/server/cluster-config", () => ({
  getConfiguredClusterSeedBayId: () => "bay-0",
}));

jest.mock("@cocalc/server/bay-registry", () => ({
  listClusterBayRegistry: async () => [
    { bay_id: "bay-1" },
    { bay_id: "bay-2" },
  ],
}));

jest.mock("@cocalc/server/inter-bay/fabric", () => ({
  getInterBayFabricClient: () => ({}),
}));

jest.mock("@cocalc/conat/inter-bay/api", () => ({
  createInterBayAccountLocalClient: ({ dest_bay }: { dest_bay: string }) => ({
    publicDirectoryShareDisableForBannedActor: (opts: any) =>
      remoteDisableMock(dest_bay, opts),
  }),
}));

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

describe("banned-account public share containment", () => {
  beforeEach(() => {
    disableForBannedActorMock.mockReset().mockResolvedValue({
      disabled_count: 1,
      share_ids: ["local-share"],
    });
    remoteDisableMock.mockReset().mockImplementation(async (bay_id) => ({
      disabled_count: 1,
      share_ids: [`${bay_id}-share`],
    }));
  });

  it("disables attributable shares on every cluster bay", async () => {
    const { disablePublicDirectorySharesForBannedAccountAcrossCluster } =
      await import("./ban-containment");

    await expect(
      disablePublicDirectorySharesForBannedAccountAcrossCluster({
        actor_account_id: ACCOUNT_ID,
        reason: "spam",
      }),
    ).resolves.toEqual({
      disabled_count: 3,
      share_ids: ["local-share", "bay-0-share", "bay-2-share"],
    });

    expect(disableForBannedActorMock).toHaveBeenCalledWith({
      actor_account_id: ACCOUNT_ID,
      reason: "spam",
    });
    expect(remoteDisableMock).toHaveBeenCalledWith("bay-0", {
      actor_account_id: ACCOUNT_ID,
      reason: "spam",
    });
    expect(remoteDisableMock).toHaveBeenCalledWith("bay-2", {
      actor_account_id: ACCOUNT_ID,
      reason: "spam",
    });
  });
});
