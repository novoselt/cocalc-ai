/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export {};

let queryMock: jest.Mock;

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    query: (...args: any[]) => queryMock(...args),
  })),
}));

describe("project move guard", () => {
  beforeEach(async () => {
    queryMock = jest.fn(async (sql: string, params?: any[]) => {
      if (sql.includes("INSERT INTO project_moves")) {
        return { rows: [{ move_id: params?.[1] }], rowCount: 1 };
      }
      return { rows: [], rowCount: 1 };
    });
    const { __test__ } = await import("./move-guard");
    __test__.resetSchema();
  });

  it("acquires, heartbeats, and releases one project guard", async () => {
    const {
      acquireProjectMoveGuard,
      heartbeatProjectMoveGuard,
      releaseProjectMoveGuard,
    } = await import("./move-guard");

    await acquireProjectMoveGuard({
      project_id: "00000000-0000-4000-8000-000000000001",
      move_id: "00000000-0000-4000-8000-000000000002",
      source_host_id: "00000000-0000-4000-8000-000000000003",
      dest_host_id: "00000000-0000-4000-8000-000000000004",
    });
    await heartbeatProjectMoveGuard({
      project_id: "00000000-0000-4000-8000-000000000001",
      move_id: "00000000-0000-4000-8000-000000000002",
    });
    await releaseProjectMoveGuard({
      project_id: "00000000-0000-4000-8000-000000000001",
      move_id: "00000000-0000-4000-8000-000000000002",
    });

    expect(
      queryMock.mock.calls.some(([sql]) =>
        sql.includes("INSERT INTO project_moves"),
      ),
    ).toBe(true);
    expect(
      queryMock.mock.calls.some(([sql]) =>
        sql.includes("UPDATE project_moves"),
      ),
    ).toBe(true);
    expect(
      queryMock.mock.calls.some(([sql]) =>
        sql.includes("DELETE FROM project_moves"),
      ),
    ).toBe(true);
  });

  it("rejects a second active move", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("INSERT INTO project_moves")) {
        return { rows: [], rowCount: 0 };
      }
      return { rows: [], rowCount: 1 };
    });
    const { acquireProjectMoveGuard } = await import("./move-guard");

    await expect(
      acquireProjectMoveGuard({
        project_id: "00000000-0000-4000-8000-000000000001",
        move_id: "00000000-0000-4000-8000-000000000002",
      }),
    ).rejects.toThrow("Project is being moved");
  });

  it("blocks ordinary starts but permits the guarded move start", async () => {
    queryMock.mockImplementation(async (sql: string) => {
      if (sql.includes("SELECT move_id")) {
        return {
          rows: [{ move_id: "00000000-0000-4000-8000-000000000002" }],
          rowCount: 1,
        };
      }
      return { rows: [], rowCount: 1 };
    });
    const { assertProjectStartAllowedDuringMove } =
      await import("./move-guard");

    await expect(
      assertProjectStartAllowedDuringMove({
        project_id: "00000000-0000-4000-8000-000000000001",
      }),
    ).rejects.toThrow("Project is being moved");
    await expect(
      assertProjectStartAllowedDuringMove({
        project_id: "00000000-0000-4000-8000-000000000001",
        project_move_id: "00000000-0000-4000-8000-000000000002",
      }),
    ).resolves.toBeUndefined();
  });
});
