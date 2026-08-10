/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details.
 */

const queryMock = jest.fn();

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({ query: (...args: any[]) => queryMock(...args) }),
}));

import { assertComputeProjectAssignedToHost } from "./host-authorization";

const project_id = "00000000-1000-4000-8000-000000000002";
const host_id = "00000000-1000-4000-8000-000000000004";

describe("compute host authorization", () => {
  beforeEach(() => queryMock.mockReset());

  it("accepts an active same-bay project assignment", async () => {
    queryMock.mockResolvedValue({ rows: [{ "?column?": 1 }] });
    await expect(
      assertComputeProjectAssignedToHost({
        project_id,
        host_id,
        bay_id: "bay-0",
      }),
    ).resolves.toBeUndefined();
    expect(queryMock).toHaveBeenCalledWith(expect.any(String), [
      project_id,
      host_id,
      "bay-0",
    ]);
    expect(queryMock.mock.calls[0][0]).toContain(
      "project_hosts.deleted IS NULL",
    );
    expect(queryMock.mock.calls[0][0]).toContain(
      "projects.deleted IS NOT true",
    );
  });

  it("rejects a host without the exact active project assignment", async () => {
    queryMock.mockResolvedValue({ rows: [] });
    await expect(
      assertComputeProjectAssignedToHost({
        project_id,
        host_id,
        bay_id: "bay-0",
      }),
    ).rejects.toMatchObject({ code: 403 });
  });
});
