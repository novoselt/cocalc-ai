/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const queryMock = jest.fn();

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({ query: queryMock }),
}));

jest.mock("@cocalc/server/bay-config", () => ({
  getConfiguredBayId: () => "bay-owner",
}));

import { getAuthoritativeProjectHardDeleteStatus } from "./hard-delete-evidence";

const PROJECT_ID = "11111111-1111-4111-8111-111111111111";

describe("authoritative project hard-delete evidence", () => {
  beforeEach(() => jest.clearAllMocks());

  it("reports a live project before considering historical tombstones", async () => {
    queryMock.mockResolvedValueOnce({ rows: [{ exists: 1 }] });
    await expect(
      getAuthoritativeProjectHardDeleteStatus({ project_id: PROJECT_ID }),
    ).resolves.toEqual({
      project_id: PROJECT_ID,
      bay_id: "bay-owner",
      status: "live",
    });
    expect(queryMock).toHaveBeenCalledTimes(1);
  });

  it("reports only a durable deleted_projects row as hard-deleted", async () => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ table_name: "deleted_projects" }] })
      .mockResolvedValueOnce({ rows: [{ exists: 1 }] });
    await expect(
      getAuthoritativeProjectHardDeleteStatus({ project_id: PROJECT_ID }),
    ).resolves.toEqual({
      project_id: PROJECT_ID,
      bay_id: "bay-owner",
      status: "hard-deleted",
    });
  });

  it.each([
    { table: null, deletedRows: undefined },
    { table: "deleted_projects", deletedRows: [] },
  ])("reports unknown when deletion evidence is absent", async (fixture) => {
    queryMock
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ table_name: fixture.table }] });
    if (fixture.deletedRows != null) {
      queryMock.mockResolvedValueOnce({ rows: fixture.deletedRows });
    }
    await expect(
      getAuthoritativeProjectHardDeleteStatus({ project_id: PROJECT_ID }),
    ).resolves.toEqual({
      project_id: PROJECT_ID,
      bay_id: "bay-owner",
      status: "unknown",
    });
  });
});
