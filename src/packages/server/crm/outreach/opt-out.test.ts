/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export {};

const getConfiguredBayIdMock = jest.fn();
const getConfiguredClusterSeedBayIdMock = jest.fn();
const applyInternalMock = jest.fn();
const bayOpsMock = jest.fn(() => ({
  applyCrmOutreachOptOutInternal: applyInternalMock,
}));
const connectMock = jest.fn();

jest.mock("@cocalc/server/bay-config", () => ({
  getConfiguredBayId: () => getConfiguredBayIdMock(),
}));

jest.mock("@cocalc/server/cluster-config", () => ({
  getConfiguredClusterSeedBayId: () => getConfiguredClusterSeedBayIdMock(),
}));

jest.mock("@cocalc/server/inter-bay/bridge", () => ({
  getInterBayBridge: () => ({ bayOps: bayOpsMock }),
}));

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({ connect: connectMock }),
}));

jest.mock("./store", () => ({ addActivity: jest.fn() }));
jest.mock("./observability", () => ({
  recordOutreachSuppression: jest.fn(),
}));

const TOKEN = "abcdefghijklmnopqrstuvwxyzABCDEF";

describe("CRM outreach opt-out inter-bay routing", () => {
  beforeEach(() => {
    getConfiguredBayIdMock.mockReturnValue("bay-2");
    getConfiguredClusterSeedBayIdMock.mockReturnValue("bay-0");
    applyInternalMock.mockReset().mockResolvedValue(undefined);
    bayOpsMock.mockClear();
    connectMock.mockReset();
  });

  it("uses the narrow internal operation without a human actor", async () => {
    const { applyOutreachOptOut } = await import("./opt-out");

    await applyOutreachOptOut(TOKEN);

    expect(bayOpsMock).toHaveBeenCalledWith("bay-0", {
      timeout_ms: 30_000,
    });
    expect(applyInternalMock).toHaveBeenCalledWith({ token: TOKEN });
    expect(connectMock).not.toHaveBeenCalled();
  });

  it("rejects malformed tokens before forwarding them", async () => {
    const { applyOutreachOptOut } = await import("./opt-out");

    await expect(applyOutreachOptOut("too-short")).rejects.toThrow(
      "invalid CRM outreach opt-out token",
    );
    await expect(applyOutreachOptOut(123 as any)).rejects.toThrow(
      "invalid CRM outreach opt-out token",
    );
    expect(applyInternalMock).not.toHaveBeenCalled();
  });

  it("propagates internal forwarding failures", async () => {
    const { applyOutreachOptOut } = await import("./opt-out");
    applyInternalMock.mockRejectedValueOnce(new Error("seed unavailable"));

    await expect(applyOutreachOptOut(TOKEN)).rejects.toThrow(
      "seed unavailable",
    );
  });
});
