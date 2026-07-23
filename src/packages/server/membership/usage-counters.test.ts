/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const queryMock = jest.fn();
const clientQueryMock = jest.fn();
const releaseMock = jest.fn();

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({
    query: (...args: any[]) => queryMock(...args),
    connect: async () => ({
      query: (...args: any[]) => clientQueryMock(...args),
      release: releaseMock,
    }),
  }),
}));

jest.mock("./usage-windows", () => ({
  ensureAccountUsageWindowSchema: jest.fn(async () => undefined),
}));

const windows = {
  "5h": {
    id: "11111111-1111-4111-8111-111111111111",
    account_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    scope: "membership" as const,
    window: "5h" as const,
    epoch: 1,
    starts_at: new Date("2026-07-23T00:00:00.000Z"),
    resets_at: new Date("2026-07-23T05:00:00.000Z"),
  },
  "7d": {
    id: "22222222-2222-4222-8222-222222222222",
    account_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    scope: "membership" as const,
    window: "7d" as const,
    epoch: 1,
    starts_at: new Date("2026-07-20T00:00:00.000Z"),
    resets_at: new Date("2026-07-27T00:00:00.000Z"),
  },
};

describe("account usage counters", () => {
  beforeEach(() => {
    jest.resetModules();
    queryMock.mockReset();
    clientQueryMock.mockReset();
    releaseMock.mockReset();
    queryMock.mockImplementation(async (sql: string) => {
      if (
        sql.includes("CREATE TABLE IF NOT EXISTS account_usage_counters") ||
        sql.includes(
          "CREATE TABLE IF NOT EXISTS account_usage_counter_states",
        ) ||
        sql.includes("CREATE INDEX IF NOT EXISTS account_usage_counter_states_")
      ) {
        return { rows: [] };
      }
      if (sql.includes("INSERT INTO account_usage_counters")) {
        return { rows: [] };
      }
      if (sql.includes("SELECT usage_window_id, category, amount")) {
        return { rows: [] };
      }
      throw new Error(`unhandled query: ${sql}`);
    });
    clientQueryMock.mockImplementation(async (sql: string) => {
      if (
        sql === "BEGIN" ||
        sql === "COMMIT" ||
        sql === "ROLLBACK" ||
        sql.includes("pg_advisory_xact_lock") ||
        sql.includes("INSERT INTO account_usage_counters") ||
        sql.includes("INSERT INTO account_usage_counter_states")
      ) {
        return { rows: [] };
      }
      if (sql.includes("FROM account_usage_counter_states")) {
        return { rows: [] };
      }
      throw new Error(`unhandled client query: ${sql}`);
    });
  });

  it("coalesces concurrent one-time baselines for the same windows", async () => {
    const loadBaseline = jest.fn(async () => [
      {
        usage_window_id: windows["5h"].id,
        category: "raw-network",
        amount: 100,
      },
      {
        usage_window_id: windows["7d"].id,
        category: "raw-network",
        amount: 200,
      },
    ]);
    const { ensureAccountUsageCountersInitialized } =
      await import("./usage-counters");
    const options = {
      account_id: windows["5h"].account_id,
      metric: "managed-egress-bytes" as const,
      windows,
      loadBaseline,
    };

    await Promise.all([
      ensureAccountUsageCountersInitialized(options),
      ensureAccountUsageCountersInitialized(options),
    ]);

    expect(loadBaseline).toHaveBeenCalledTimes(1);
    expect(
      clientQueryMock.mock.calls.filter(([sql]) =>
        `${sql}`.includes("pg_advisory_xact_lock"),
      ),
    ).toHaveLength(1);
    expect(releaseMock).toHaveBeenCalledTimes(1);
  });

  it("batches both window increments into one additive upsert", async () => {
    const { flushAccountUsageCounters, recordAccountUsageCounterDelta } =
      await import("./usage-counters");

    recordAccountUsageCounterDelta({
      metric: "managed-cpu-seconds",
      windows,
      amount: 12.5,
    });
    recordAccountUsageCounterDelta({
      metric: "managed-cpu-seconds",
      windows,
      amount: 7.5,
    });
    await flushAccountUsageCounters();

    const flushCall = queryMock.mock.calls.find(([sql]) =>
      `${sql}`.includes("account_usage_counters.amount + EXCLUDED.amount"),
    );
    expect(flushCall).toBeDefined();
    expect(JSON.parse(flushCall?.[1][0])).toEqual([
      {
        usage_window_id: windows["5h"].id,
        metric: "managed-cpu-seconds",
        category: "",
        amount: 20,
      },
      {
        usage_window_id: windows["7d"].id,
        metric: "managed-cpu-seconds",
        category: "",
        amount: 20,
      },
    ]);
  });

  it("bounds concurrent historical baseline scans", async () => {
    let active = 0;
    let maxActive = 0;
    const { ensureAccountUsageCountersInitialized } =
      await import("./usage-counters");
    const initializations = Array.from({ length: 6 }, (_, index) => {
      const suffix = `${index + 1}`.padStart(12, "0");
      const account_id = `aaaaaaaa-aaaa-4aaa-8aaa-${suffix}`;
      const isolatedWindows = {
        "5h": {
          ...windows["5h"],
          id: `11111111-1111-4111-8111-${suffix}`,
          account_id,
        },
        "7d": {
          ...windows["7d"],
          id: `22222222-2222-4222-8222-${suffix}`,
          account_id,
        },
      };
      return ensureAccountUsageCountersInitialized({
        account_id,
        metric: "managed-egress-bytes",
        windows: isolatedWindows,
        loadBaseline: async () => {
          active += 1;
          maxActive = Math.max(maxActive, active);
          await new Promise((resolve) => setTimeout(resolve, 10));
          active -= 1;
          return [];
        },
      });
    });

    await Promise.all(initializations);
    expect(maxActive).toBe(2);
  });
});
