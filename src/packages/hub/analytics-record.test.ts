/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { PostgreSQL } from "@cocalc/database/postgres/types";

import { recordAnalyticsData } from "./analytics-record";

const TOKEN = "f5afbd12-fdb6-42ad-a4de-095bc9e15a55";
const ACCOUNT_ID = "10bd9445-01f7-486f-aa9a-c04e794366ba";

function databaseWithQuery(query = jest.fn()): {
  database: PostgreSQL;
  query: jest.Mock;
} {
  return {
    database: { _pool: { query } } as unknown as PostgreSQL,
    query,
  };
}

describe("recordAnalyticsData", () => {
  it("uses an awaited upsert that preserves first-touch fields", async () => {
    const { database, query } = databaseWithQuery();
    await recordAnalyticsData({
      database,
      piiRetention: false,
      record: {
        accountId: ACCOUNT_ID,
        data: {
          landing: "https://cocalc.ai/features/sage",
          oversized: "x".repeat(2_100),
        },
      },
      token: TOKEN,
    });

    expect(query).toHaveBeenCalledTimes(1);
    const [sql, values] = query.mock.calls[0];
    expect(sql).toContain("ON CONFLICT (token) DO UPDATE");
    expect(sql).toContain("data = COALESCE(analytics.data, EXCLUDED.data)");
    expect(sql).toContain(
      "account_id = COALESCE(analytics.account_id, EXCLUDED.account_id)",
    );
    expect(values[0]).toBe(TOKEN);
    expect(JSON.parse(values[1])).toEqual({
      landing: "https://cocalc.ai/features/sage",
      oversized: "x".repeat(2_000),
    });
    expect(values[3]).toBe(ACCOUNT_ID);
  });

  it("rejects invalid browser-controlled identifiers", async () => {
    const { database, query } = databaseWithQuery();
    await recordAnalyticsData({
      database,
      piiRetention: false,
      record: { accountId: "not-an-account-id" },
      token: TOKEN,
    });
    await recordAnalyticsData({
      database,
      piiRetention: false,
      record: { data: { landing: "https://cocalc.ai/" } },
      token: "not-a-token",
    });

    expect(query).not.toHaveBeenCalled();
  });
});
