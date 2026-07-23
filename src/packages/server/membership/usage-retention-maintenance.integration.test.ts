/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { after, before, getPool } from "@cocalc/server/test";
import { uuid } from "@cocalc/util/misc";
import { getManagedEgressCategoryUsageForAccount } from "./managed-egress";
import { getRecentManagedCpuEventsForAccount } from "./managed-cpu";
import { runUsageRetentionMaintenanceOnce } from "./usage-retention-maintenance";

beforeAll(async () => {
  await before();
}, 15_000);
afterAll(after);

describe("managed usage retention database integration", () => {
  it("deletes only expired detail in bounded batches", async () => {
    const account_id = uuid();
    const old = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    await getManagedEgressCategoryUsageForAccount({
      account_id,
      category: "control-plane-conat",
    });
    await getRecentManagedCpuEventsForAccount({ account_id });
    await getPool().query(
      `
        INSERT INTO account_managed_egress_events
          (id, account_id, category, bytes, occurred_at)
        VALUES (gen_random_uuid(), $1, 'raw-network', 1, $2)
      `,
      [account_id, old],
    );
    await getPool().query(
      `
        INSERT INTO account_managed_egress_rollups
          (bucket_start, account_id, category, bytes, event_count, first_occurred_at, last_occurred_at)
        VALUES ($2, $1, 'raw-network', 1, 1, $2, $2)
      `,
      [account_id, old],
    );
    await getPool().query(
      `
        INSERT INTO account_cpu_usage_events
          (id, account_id, cpu_seconds, sample_ended_at)
        VALUES (gen_random_uuid(), $1, 1, $2)
      `,
      [account_id, old],
    );

    await expect(runUsageRetentionMaintenanceOnce()).resolves.toEqual({
      account_managed_egress_events: 1,
      account_managed_egress_rollups: 1,
      account_cpu_usage_events: 1,
    });
  });
});
