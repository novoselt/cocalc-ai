/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const queryMock = jest.fn();

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({ query: queryMock }),
}));

describe("project sole-owner assertion", () => {
  beforeEach(() => {
    queryMock.mockReset();
  });

  it("accepts an authoritative sole-owner result", async () => {
    queryMock.mockResolvedValue({ rows: [{ sole_owner: true }] });
    const { assertProjectSoleOwner } = await import("./sole-owner");

    await expect(
      assertProjectSoleOwner({
        project_id: "project-1",
        account_id: "account-1",
      }),
    ).resolves.toBeUndefined();

    const sql = queryMock.mock.calls[0]?.[0];
    expect(sql).toContain("users #>> ARRAY[$2::TEXT, 'group'] = 'owner'");
    expect(sql).toContain("member.key <> $2::TEXT");
  });

  it.each([
    ["a co-owned project", [{ sole_owner: false }]],
    ["a missing project", []],
  ])("rejects %s", async (_label, rows) => {
    queryMock.mockResolvedValue({ rows });
    const { assertProjectSoleOwner } = await import("./sole-owner");

    await expect(
      assertProjectSoleOwner({
        project_id: "project-1",
        account_id: "account-1",
      }),
    ).rejects.toThrow("is not solely owned");
  });
});
