/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { after, before, getPool } from "@cocalc/server/test";
import { uuid } from "@cocalc/util/misc";
import {
  ensureAccountUsageCountersInitialized,
  flushAccountUsageCounters,
  getAccountUsageCounterValues,
  recordAccountUsageCounterDelta,
} from "./usage-counters";
import { ensureAccountUsageWindowsForEvent } from "./usage-windows";
import {
  getManagedEgressCategoryUsageForAccount,
  getManagedEgressUsageForAccount,
} from "./managed-egress";
import {
  getManagedCpuUsageForAccount,
  getRecentManagedCpuEventsForAccount,
} from "./managed-cpu";

beforeAll(async () => {
  await before();
}, 15_000);
afterAll(after);

describe("account usage counter database integration", () => {
  it("initializes a baseline and applies batched increments", async () => {
    const account_id = uuid();
    const windows = await ensureAccountUsageWindowsForEvent({
      account_id,
      occurred_at: new Date(),
    });
    await ensureAccountUsageCountersInitialized({
      account_id,
      metric: "managed-egress-bytes",
      windows,
      loadBaseline: async ({ windows }) =>
        windows.map(({ id, window }) => ({
          usage_window_id: id,
          category: "raw-network",
          amount: window === "5h" ? 100 : 200,
        })),
    });

    await expect(
      getAccountUsageCounterValues({
        metric: "managed-egress-bytes",
        windows,
      }),
    ).resolves.toEqual({
      "5h": { "raw-network": 100 },
      "7d": { "raw-network": 200 },
    });

    recordAccountUsageCounterDelta({
      metric: "managed-egress-bytes",
      windows,
      category: "raw-network",
      amount: 25,
    });
    await flushAccountUsageCounters();

    const { rows } = await getPool().query(
      `SELECT usage_window_id, metric, category, amount FROM account_usage_counters WHERE usage_window_id = ANY($1::uuid[])`,
      [Object.values(windows).map(({ id }) => id)],
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ amount: "125" }),
        expect.objectContaining({ amount: "225" }),
      ]),
    );

    await expect(
      getAccountUsageCounterValues({
        metric: "managed-egress-bytes",
        windows,
      }),
    ).resolves.toEqual({
      "5h": { "raw-network": 125 },
      "7d": { "raw-network": 225 },
    });
  });

  it("backfills managed egress policy counters from detailed rollups", async () => {
    const account_id = uuid();
    const occurred_at = new Date(Date.now() - 60_000);
    const windows = await ensureAccountUsageWindowsForEvent({
      account_id,
      occurred_at,
    });
    await getManagedEgressCategoryUsageForAccount({
      account_id,
      category: "control-plane-conat",
      now: occurred_at,
    });
    await getPool().query(
      `
        INSERT INTO account_managed_egress_rollups
          (bucket_start, account_id, category, bytes, event_count, first_occurred_at, last_occurred_at)
        VALUES ($1, $2, 'raw-network', 345, 1, $1, $1)
      `,
      [occurred_at, account_id],
    );

    await expect(
      getManagedEgressUsageForAccount({ account_id }),
    ).resolves.toMatchObject({
      managed_egress_5h_bytes: 345,
      managed_egress_7d_bytes: 345,
      managed_egress_categories_5h_bytes: { "raw-network": 345 },
      managed_egress_categories_7d_bytes: { "raw-network": 345 },
      managed_egress_5h_starts_at: windows["5h"].starts_at,
      managed_egress_7d_starts_at: windows["7d"].starts_at,
    });
  });

  it("backfills managed CPU policy counters from detailed events", async () => {
    const account_id = uuid();
    const sample_ended_at = new Date(Date.now() - 60_000);
    const windows = await ensureAccountUsageWindowsForEvent({
      account_id,
      occurred_at: sample_ended_at,
    });
    await getRecentManagedCpuEventsForAccount({ account_id });
    await getPool().query(
      `
        INSERT INTO account_cpu_usage_events
          (id, account_id, cpu_seconds, sample_ended_at)
        VALUES (gen_random_uuid(), $1, 67.5, $2)
      `,
      [account_id, sample_ended_at],
    );

    await expect(
      getManagedCpuUsageForAccount({ account_id }),
    ).resolves.toMatchObject({
      managed_cpu_5h_seconds: 67.5,
      managed_cpu_7d_seconds: 67.5,
      managed_cpu_5h_starts_at: windows["5h"].starts_at,
      managed_cpu_7d_starts_at: windows["7d"].starts_at,
    });
  });
});
