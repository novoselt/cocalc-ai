/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool from "@cocalc/database/pool";
import { ensureComputeWorkQueueSchema } from "./schema";

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe("ensureComputeWorkQueueSchema", () => {
  it("adds and validates deterministic queue ordering atomically", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("FROM information_schema.columns")) {
        return {
          rows: [{ has_default: true, is_not_null: true, is_unique: true }],
        };
      }
      return { rows: [] };
    });
    const release = jest.fn();
    (getPool as jest.Mock).mockReturnValue({
      connect: jest.fn().mockResolvedValue({ query, release }),
    });

    await ensureComputeWorkQueueSchema();

    expect(query.mock.calls.map(([sql]) => sql)).toEqual(
      expect.arrayContaining([
        expect.stringContaining("BEGIN"),
        expect.stringContaining("pg_advisory_xact_lock"),
        expect.stringContaining(
          "ADD COLUMN IF NOT EXISTS queue_order BIGSERIAL",
        ),
        expect.stringContaining("CREATE UNIQUE INDEX IF NOT EXISTS"),
        expect.stringContaining("COMMIT"),
      ]),
    );
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("rolls back when the resulting queue column is invalid", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("FROM information_schema.columns")) {
        return {
          rows: [{ has_default: false, is_not_null: true, is_unique: true }],
        };
      }
      return { rows: [] };
    });
    const release = jest.fn();
    (getPool as jest.Mock).mockReturnValue({
      connect: jest.fn().mockResolvedValue({ query, release }),
    });

    await expect(ensureComputeWorkQueueSchema()).rejects.toThrow(
      "compute_resource_work.queue_order",
    );

    expect(query.mock.calls.map(([sql]) => sql)).toContain("ROLLBACK");
    expect(release).toHaveBeenCalledTimes(1);
  });
});
