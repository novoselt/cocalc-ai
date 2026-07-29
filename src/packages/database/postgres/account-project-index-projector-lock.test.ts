/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const connectMock = jest.fn();

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({
    connect: (...args: unknown[]) => connectMock(...args),
  }),
}));

import { drainAccountProjectIndexProjection } from "./account-project-index-projector";

describe("account_project_index projector locking", () => {
  beforeEach(() => {
    connectMock.mockReset();
  });

  it("does not drain events while another bay projector owns the lock", async () => {
    let markFirstSelectStarted!: () => void;
    const firstSelectStarted = new Promise<void>((resolve) => {
      markFirstSelectStarted = resolve;
    });
    let finishFirstSelect!: () => void;
    const firstSelectCanFinish = new Promise<void>((resolve) => {
      finishFirstSelect = resolve;
    });

    const firstClient = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("pg_try_advisory_lock")) {
          return { rows: [{ locked: true }], rowCount: 1 };
        }
        if (sql.includes("FROM project_events_outbox")) {
          markFirstSelectStarted();
          await firstSelectCanFinish;
          return { rows: [], rowCount: 0 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };
    const secondClient = {
      query: jest.fn(async (sql: string) => {
        if (sql.includes("pg_try_advisory_lock")) {
          return { rows: [{ locked: false }], rowCount: 1 };
        }
        return { rows: [], rowCount: 0 };
      }),
      release: jest.fn(),
    };
    connectMock
      .mockResolvedValueOnce(firstClient)
      .mockResolvedValueOnce(secondClient);

    const firstDrain = drainAccountProjectIndexProjection({
      bay_id: "bay-0",
      limit: 10,
      dry_run: false,
    });
    await firstSelectStarted;

    await expect(
      drainAccountProjectIndexProjection({
        bay_id: "bay-0",
        limit: 10,
        dry_run: false,
      }),
    ).resolves.toEqual({
      bay_id: "bay-0",
      dry_run: false,
      requested_limit: 10,
      scanned_events: 0,
      applied_events: 0,
      inserted_rows: 0,
      deleted_rows: 0,
      feed_events: [],
      event_types: {},
    });
    expect(
      secondClient.query.mock.calls.some(([sql]) =>
        `${sql}`.includes("FROM project_events_outbox"),
      ),
    ).toBe(false);
    expect(secondClient.query).toHaveBeenCalledWith("ROLLBACK");

    finishFirstSelect();
    await expect(firstDrain).resolves.toMatchObject({
      scanned_events: 0,
      applied_events: 0,
    });
    expect(firstClient.query).toHaveBeenCalledWith(
      "SELECT pg_advisory_unlock(hashtext($1))",
      ["account-project-index-projector:bay-0"],
    );
    expect(firstClient.release).toHaveBeenCalledTimes(1);
    expect(secondClient.release).toHaveBeenCalledTimes(1);
  });
});
