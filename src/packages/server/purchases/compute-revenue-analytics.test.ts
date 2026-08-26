/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  getTransactionClient,
  initEphemeralDatabase,
  type PoolClient,
} from "@cocalc/database/pool";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { uuid } from "@cocalc/util/misc";
import {
  allocateIntegerByWeights,
  rebuildComputeRevenueDays,
} from "./compute-revenue-analytics";

describe("compute revenue analytics", () => {
  let client: PoolClient;

  beforeAll(async () => {
    await initEphemeralDatabase({});
    client = await getTransactionClient();
  }, 30_000);

  afterAll(async () => {
    await client.query("ROLLBACK");
    client.release();
  }, 30_000);

  it("distributes integer cents deterministically", () => {
    expect(allocateIntegerByWeights(101, [1, 1])).toEqual([51, 50]);
    expect(allocateIntegerByWeights(5, [1, 3])).toEqual([1, 4]);
    expect(allocateIntegerByWeights(-5, [1, 3])).toEqual([-1, -4]);
  });

  it("projects net compute revenue and machine usage for complete UTC days", async () => {
    const accountId = uuid();
    const hostId = uuid();
    const volumeId = uuid();
    await client.query(
      "INSERT INTO accounts (account_id,email_address) VALUES ($1,$2)",
      [accountId, `${accountId}@example.com`],
    );
    const hostDescription = {
      type: "dedicated-host",
      host_id: hostId,
      resource_kind: "project-host",
      product_kind: "dedicated-host",
      provider: "gcp",
      billing_state: "running",
      funding_lane: "prepaid",
      hourly_cost_usd: "0.04",
      pricing_snapshot: {
        version: 1,
        billing_state: "running",
        hourly_cost_usd: "0.04",
        components: [
          {
            key: "vm",
            label: "VM",
            hourly_cost_usd: "0.03",
            billing_states: ["running"],
          },
          {
            key: "gpu",
            label: "GPU",
            hourly_cost_usd: "0.01",
            billing_states: ["running"],
          },
        ],
        configuration: {},
      },
    };
    const { rows: hostRows } = await client.query<{ id: number }>(
      `INSERT INTO purchases
        (time,account_id,cost,cost_per_hour,period_start,period_end,
         service,description,tag)
       VALUES ($1,$2,$3,$4,$1,$5,'dedicated-host',$6,$7)
       RETURNING id`,
      [
        "2026-07-01T00:00:00Z",
        accountId,
        "1.01",
        "0.04",
        "2026-07-03T00:00:00Z",
        hostDescription,
        `dedicated-host:${hostId}`,
      ],
    );
    await client.query(
      `INSERT INTO purchases
        (time,account_id,cost,cost_per_hour,period_start,period_end,
         service,description,tag)
       VALUES ($1,$2,$3,$4,$1,$5,'dedicated-host',$6,$7)`,
      [
        "2026-07-01T00:00:00Z",
        accountId,
        "0.24",
        "0.01",
        "2026-07-02T00:00:00Z",
        {
          type: "dedicated-host",
          host_id: volumeId,
          resource_kind: "compute-volume",
          product_kind: "virtual-machine",
          provider: "nebius",
          billing_state: "stopped",
          funding_lane: "prepaid",
          hourly_cost_usd: "0.01",
          pricing_snapshot: {
            version: 1,
            billing_state: "stopped",
            hourly_cost_usd: "0.01",
            components: [
              {
                key: "disk",
                label: "Disk",
                hourly_cost_usd: "0.01",
                billing_states: ["running", "stopped"],
              },
            ],
            configuration: {},
          },
        },
        `dedicated-host:${volumeId}`,
      ],
    );

    await rebuildComputeRevenueDays({
      start: "2026-07-01",
      end: "2026-07-03",
      client,
    });
    const { rows: revenue } = await client.query(
      `SELECT day::text,product,provider,cost_component,revenue_cents::int
         FROM compute_revenue_daily
        WHERE bay_id=$1
        ORDER BY day,product,cost_component`,
      [getConfiguredBayId()],
    );
    expect(revenue).toEqual([
      {
        day: "2026-07-01",
        product: "dedicated-host",
        provider: "gcp",
        cost_component: "compute",
        revenue_cents: 38,
      },
      {
        day: "2026-07-01",
        product: "dedicated-host",
        provider: "gcp",
        cost_component: "gpu",
        revenue_cents: 13,
      },
      {
        day: "2026-07-01",
        product: "virtual-machine",
        provider: "nebius",
        cost_component: "storage",
        revenue_cents: 24,
      },
      {
        day: "2026-07-02",
        product: "dedicated-host",
        provider: "gcp",
        cost_component: "compute",
        revenue_cents: 38,
      },
      {
        day: "2026-07-02",
        product: "dedicated-host",
        provider: "gcp",
        cost_component: "gpu",
        revenue_cents: 12,
      },
    ]);
    const { rows: usage } = await client.query(
      `SELECT day::text,product,provider,running_unit_seconds::int,
              distinct_running_units
         FROM compute_usage_daily
        WHERE bay_id=$1
        ORDER BY day,product,provider`,
      [getConfiguredBayId()],
    );
    expect(usage).toEqual([
      {
        day: "2026-07-01",
        product: "dedicated-host",
        provider: "gcp",
        running_unit_seconds: 86_400,
        distinct_running_units: 1,
      },
      {
        day: "2026-07-02",
        product: "dedicated-host",
        provider: "gcp",
        running_unit_seconds: 86_400,
        distinct_running_units: 1,
      },
    ]);

    await client.query(
      `INSERT INTO purchases
        (time,account_id,cost,service,description)
       VALUES ('2026-07-04T00:00:00Z',$1,-1.01,'refund',$2)`,
      [
        accountId,
        {
          type: "refund",
          purchase_id: hostRows[0].id,
          reason: "requested_by_customer",
          notes: "test refund",
        },
      ],
    );
    await rebuildComputeRevenueDays({
      start: "2026-07-01",
      end: "2026-07-03",
      client,
    });
    const { rows: afterRefund } = await client.query(
      `SELECT product,SUM(revenue_cents)::int AS revenue_cents
         FROM compute_revenue_daily
        WHERE bay_id=$1
        GROUP BY product
        ORDER BY product`,
      [getConfiguredBayId()],
    );
    expect(afterRefund).toEqual([
      { product: "virtual-machine", revenue_cents: 24 },
    ]);
    const { rows: hostUsage } = await client.query(
      `SELECT 1 FROM compute_usage_daily
        WHERE bay_id=$1 AND product='dedicated-host'`,
      [getConfiguredBayId()],
    );
    expect(hostUsage).toHaveLength(2);
  });
});
