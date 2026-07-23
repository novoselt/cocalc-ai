/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const expireDueLrosMock = jest.fn();

jest.mock("./lro-db", () => ({
  expireDueLros: (...args: any[]) => expireDueLrosMock(...args),
}));

describe("LRO expiration maintenance", () => {
  beforeEach(() => {
    jest.resetModules();
    expireDueLrosMock.mockReset();
  });

  it("drains bounded batches without polling from every claimant", async () => {
    expireDueLrosMock
      .mockResolvedValueOnce(Array.from({ length: 1000 }, () => ({})))
      .mockResolvedValueOnce(Array.from({ length: 12 }, () => ({})));
    const { runLroExpirationMaintenanceOnce } =
      await import("./expiration-maintenance");

    await expect(runLroExpirationMaintenanceOnce()).resolves.toBe(1012);
    expect(expireDueLrosMock).toHaveBeenCalledTimes(2);
    expect(expireDueLrosMock).toHaveBeenNthCalledWith(1, { limit: 1000 });
  });
});
