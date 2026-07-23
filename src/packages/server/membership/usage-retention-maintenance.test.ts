/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const queryMock = jest.fn();

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({
    query: (...args: any[]) => queryMock(...args),
  }),
}));

describe("managed usage retention maintenance", () => {
  beforeEach(() => {
    jest.resetModules();
    queryMock.mockReset();
    queryMock.mockResolvedValue({ rowCount: 5, rows: [] });
  });

  it("uses bounded indexed-time deletion batches", async () => {
    const { runUsageRetentionMaintenanceOnce } =
      await import("./usage-retention-maintenance");

    await expect(runUsageRetentionMaintenanceOnce()).resolves.toEqual({
      account_managed_egress_events: 5,
      account_managed_egress_rollups: 5,
      account_cpu_usage_events: 5,
    });
    expect(queryMock).toHaveBeenCalledTimes(3);
    for (const [sql, params] of queryMock.mock.calls) {
      expect(sql).toContain("FOR UPDATE SKIP LOCKED");
      expect(sql).toContain("LIMIT $2");
      expect(params).toEqual([35, 5000]);
    }
  });
});
