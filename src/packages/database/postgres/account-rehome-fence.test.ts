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

import { withAccountRehomeUserQueryFence } from "./account-rehome-fence";
import { getScopedQueryClient } from "./query-client-context";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";

describe("account rehome user-query fence", () => {
  beforeEach(() => {
    connectMock.mockReset();
  });

  it("keeps its transaction client private to the fenced async request", async () => {
    const client = {
      query: jest.fn(async (sql: string) => {
        if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
          return { rows: [] };
        }
        if (sql.includes("pg_advisory_xact_lock")) {
          return { rows: [] };
        }
        if (sql.includes("to_regclass")) {
          return { rows: [{ table_name: null }] };
        }
        if (sql.includes("FROM accounts")) {
          return { rows: [{ home_bay_id: "bay-0" }] };
        }
        throw new Error(`unexpected sql: ${sql}`);
      }),
      release: jest.fn(),
    };
    connectMock.mockResolvedValue(client);
    const database: any = {};
    let enterFn!: () => void;
    const mayEnterFn = new Promise<void>((resolve) => (enterFn = resolve));
    let fnStarted!: () => void;
    const started = new Promise<void>((resolve) => (fnStarted = resolve));

    const fenced = withAccountRehomeUserQueryFence({
      database,
      account_id: ACCOUNT_ID,
      fn: async () => {
        fnStarted();
        await mayEnterFn;
        expect(getScopedQueryClient(database)).toBe(client);
        expect(database._query_client).toBeUndefined();
        return "result";
      },
    });

    await started;
    // This assertion runs concurrently, outside the fenced async context.
    expect(getScopedQueryClient(database)).toBeUndefined();
    expect(database._query_client).toBeUndefined();
    enterFn();

    await expect(fenced).resolves.toBe("result");
    expect(client.query).toHaveBeenCalledWith("COMMIT");
    expect(client.query).not.toHaveBeenCalledWith("ROLLBACK");
    expect(client.release).toHaveBeenCalledTimes(1);
  });
});
