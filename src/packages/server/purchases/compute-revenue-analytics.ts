/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import getPool, { type PoolClient } from "@cocalc/database/pool";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import type {
  ComputeRevenueCostComponent,
  ComputeRevenueProduct,
} from "@cocalc/conat/hub/api/purchases";
import type {
  DedicatedHostPricingComponent,
  DedicatedHostPurchase,
} from "@cocalc/util/db-schema/purchases";
import { moneyRoundToCents } from "@cocalc/util/money";

const logger = getLogger("purchases:compute-revenue-analytics");
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_BACKFILL_DAYS = 31;
const CHANGE_SCAN_OVERLAP_MS = DAY_MS;

type Queryable = Pick<PoolClient, "query">;

interface ComputePurchaseRow {
  id: number;
  time: Date;
  cost: string | null;
  cost_per_hour: string | null;
  cost_so_far: string | null;
  period_start: Date | null;
  period_end: Date | null;
  description: DedicatedHostPurchase;
  refunded: boolean;
}

interface EgressIntervalRow {
  purchase_id: number;
  amount_usd: string;
  started_at: Date;
  ended_at: Date;
}

interface RevenueAggregate {
  day: string;
  product: ComputeRevenueProduct;
  provider: string;
  cost_component: ComputeRevenueCostComponent;
  revenue_cents: number;
  purchase_ids: Set<number>;
}

interface UsageAggregate {
  day: string;
  product: ComputeRevenueProduct;
  provider: string;
  running_unit_seconds: number;
  resource_ids: Set<string>;
}

export interface ComputeRevenueAnalyticsMaintenanceResult {
  rebuilt_days: number;
  complete_through: string;
}

export function utcDay(value: Date | string | number): Date {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    throw Error("invalid compute revenue analytics date");
  }
  return new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
  );
}

function dayKey(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function nextDay(value: Date): Date {
  return new Date(value.valueOf() + DAY_MS);
}

function overlapSeconds(
  start: Date,
  end: Date,
  rangeStart: Date,
  rangeEnd: Date,
): number {
  return Math.max(
    0,
    (Math.min(end.valueOf(), rangeEnd.valueOf()) -
      Math.max(start.valueOf(), rangeStart.valueOf())) /
      1000,
  );
}

export function allocateIntegerByWeights(
  total: number,
  weights: number[],
): number[] {
  if (weights.length === 0) return [];
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (!(weightTotal > 0) || total === 0) return weights.map(() => 0);
  const sign = total < 0 ? -1 : 1;
  const absoluteTotal = Math.abs(total);
  const exact = weights.map((weight) => (absoluteTotal * weight) / weightTotal);
  const result = exact.map(Math.floor);
  let remainder = absoluteTotal - result.reduce((sum, value) => sum + value, 0);
  const order = exact
    .map((value, index) => ({ index, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction || a.index - b.index);
  for (let i = 0; i < remainder; i += 1) {
    result[order[i % order.length].index] += 1;
  }
  return result.map((value) => value * sign);
}

function productForPurchase(
  description: DedicatedHostPurchase,
): ComputeRevenueProduct {
  if (
    description.product_kind === "dedicated-host" ||
    description.product_kind === "virtual-machine"
  ) {
    return description.product_kind;
  }
  if (
    description.resource_kind === "compute-vm" ||
    description.resource_kind === "compute-volume" ||
    description.resource_kind === "compute-egress"
  ) {
    return "virtual-machine";
  }
  const name = `${description.host_name ?? ""}`.toLowerCase();
  return name.startsWith("vm:") || name.startsWith("vm volume:")
    ? "virtual-machine"
    : "dedicated-host";
}

function componentForPricingKey(
  key: DedicatedHostPricingComponent["key"],
): ComputeRevenueCostComponent {
  switch (key) {
    case "vm":
      return "compute";
    case "gpu":
      return "gpu";
    case "disk":
    case "shared_scratch_disk":
      return "storage";
    case "windows_license":
    case "public_ipv4":
      return "other";
  }
}

function componentWeights(
  description: DedicatedHostPurchase,
): Array<{ component: ComputeRevenueCostComponent; weight: number }> {
  if (description.resource_kind === "compute-egress") {
    return [{ component: "network-egress", weight: 1 }];
  }
  const byComponent = new Map<ComputeRevenueCostComponent, number>();
  for (const item of description.pricing_snapshot?.components ?? []) {
    const weight = Number(item.hourly_cost_usd);
    if (!(weight > 0)) continue;
    const component = componentForPricingKey(item.key);
    byComponent.set(component, (byComponent.get(component) ?? 0) + weight);
  }
  if (byComponent.size === 0) {
    return [{ component: "other", weight: 1 }];
  }
  return [...byComponent].map(([component, weight]) => ({
    component,
    weight,
  }));
}

function purchasePeriod(
  purchase: ComputePurchaseRow,
  targetEnd: Date,
): { start: Date; end: Date } | null {
  const start = new Date(purchase.period_start ?? purchase.time);
  const end = new Date(purchase.period_end ?? targetEnd);
  return end > start ? { start, end } : null;
}

function dailyWeightsForPeriod(
  start: Date,
  end: Date,
): Array<{ day: string; seconds: number }> {
  const values: Array<{ day: string; seconds: number }> = [];
  for (let cursor = utcDay(start); cursor < end; cursor = nextDay(cursor)) {
    const cursorEnd = nextDay(cursor);
    const seconds = overlapSeconds(start, end, cursor, cursorEnd);
    if (seconds > 0) values.push({ day: dayKey(cursor), seconds });
  }
  return values;
}

function egressDailyWeights(
  intervals: EgressIntervalRow[],
): Array<{ day: string; weight: number }> {
  const byDay = new Map<string, number>();
  for (const interval of intervals) {
    const start = new Date(interval.started_at);
    const end = new Date(interval.ended_at);
    const duration = Math.max(0, end.valueOf() - start.valueOf());
    if (duration === 0) continue;
    const amount = Number(interval.amount_usd);
    for (let cursor = utcDay(start); cursor < end; cursor = nextDay(cursor)) {
      const cursorEnd = nextDay(cursor);
      const overlap = overlapSeconds(start, end, cursor, cursorEnd) * 1000;
      if (overlap <= 0) continue;
      const key = dayKey(cursor);
      byDay.set(key, (byDay.get(key) ?? 0) + (amount * overlap) / duration);
    }
  }
  return [...byDay]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([day, weight]) => ({ day, weight }));
}

function purchaseDailyCents({
  purchase,
  period,
  intervals,
}: {
  purchase: ComputePurchaseRow;
  period: { start: Date; end: Date };
  intervals: EgressIntervalRow[];
}): Array<{ day: string; cents: number }> {
  const egressWeights =
    purchase.description.resource_kind === "compute-egress"
      ? egressDailyWeights(intervals)
      : [];
  const dayWeights =
    egressWeights.length > 0
      ? egressWeights
      : dailyWeightsForPeriod(period.start, period.end).map(
          ({ day, seconds }) => ({ day, weight: seconds }),
        );
  if (purchase.cost != null) {
    const cents = moneyRoundToCents(purchase.cost).mul(100).toNumber();
    return allocateIntegerByWeights(
      cents,
      dayWeights.map(({ weight }) => weight),
    ).map((value, index) => ({ day: dayWeights[index].day, cents: value }));
  }
  if (egressWeights.length > 0) {
    return egressWeights.map(({ day, weight }) => ({
      day,
      cents: moneyRoundToCents(weight).mul(100).toNumber(),
    }));
  }
  const hourly = Number(purchase.cost_per_hour ?? 0);
  return dayWeights.map(({ day, weight }) => ({
    day,
    cents: Math.round((hourly * weight * 100) / 3600),
  }));
}

function addRevenue(
  aggregates: Map<string, RevenueAggregate>,
  row: Omit<RevenueAggregate, "purchase_ids"> & { purchase_id: number },
): void {
  const key = [row.day, row.product, row.provider, row.cost_component].join(
    "\0",
  );
  const aggregate = aggregates.get(key) ?? {
    day: row.day,
    product: row.product,
    provider: row.provider,
    cost_component: row.cost_component,
    revenue_cents: 0,
    purchase_ids: new Set<number>(),
  };
  aggregate.revenue_cents += row.revenue_cents;
  aggregate.purchase_ids.add(row.purchase_id);
  aggregates.set(key, aggregate);
}

function addUsage(
  aggregates: Map<string, UsageAggregate>,
  row: Omit<UsageAggregate, "resource_ids"> & { resource_id: string },
): void {
  const key = [row.day, row.product, row.provider].join("\0");
  const aggregate = aggregates.get(key) ?? {
    day: row.day,
    product: row.product,
    provider: row.provider,
    running_unit_seconds: 0,
    resource_ids: new Set<string>(),
  };
  aggregate.running_unit_seconds += row.running_unit_seconds;
  aggregate.resource_ids.add(row.resource_id);
  aggregates.set(key, aggregate);
}

async function listComputePurchases({
  start,
  end,
  client,
}: {
  start: Date;
  end: Date;
  client: Queryable;
}): Promise<ComputePurchaseRow[]> {
  const { rows } = await client.query<ComputePurchaseRow>(
    `SELECT p.id, p.time, p.cost::text, p.cost_per_hour::text,
            p.cost_so_far::text, p.period_start, p.period_end, p.description,
            EXISTS (
              SELECT 1
                FROM purchases r
               WHERE r.service='refund'
                 AND r.description->>'type'='refund'
                 AND r.description->>'purchase_id' ~ '^[0-9]+$'
                 AND (r.description->>'purchase_id')::bigint=p.id
            ) AS refunded
       FROM purchases p
      WHERE p.service='dedicated-host'
        AND p.description->>'type'='dedicated-host'
        AND COALESCE(p.period_start, p.time) < $2
        AND COALESCE(p.period_end, $2) > $1
      ORDER BY p.id`,
    [start, end],
  );
  return rows;
}

async function listEgressIntervals({
  purchaseIds,
  client,
}: {
  purchaseIds: number[];
  client: Queryable;
}): Promise<Map<number, EgressIntervalRow[]>> {
  const byPurchase = new Map<number, EgressIntervalRow[]>();
  if (purchaseIds.length === 0) return byPurchase;
  const { rows } = await client.query<EgressIntervalRow>(
    `SELECT purchase_id, amount_usd::text, started_at, ended_at
       FROM compute_egress_meter_intervals
      WHERE purchase_id=ANY($1::bigint[])
      ORDER BY purchase_id, started_at`,
    [purchaseIds],
  );
  for (const row of rows) {
    const list = byPurchase.get(Number(row.purchase_id)) ?? [];
    list.push({ ...row, purchase_id: Number(row.purchase_id) });
    byPurchase.set(Number(row.purchase_id), list);
  }
  return byPurchase;
}

export async function rebuildComputeRevenueDays({
  start,
  end,
  client: providedClient,
}: {
  start: Date | string;
  end: Date | string;
  client?: PoolClient;
}): Promise<number> {
  const rangeStart = utcDay(start);
  const rangeEnd = utcDay(end);
  if (rangeStart >= rangeEnd) return 0;
  const ownedClient = providedClient == null;
  const client = providedClient ?? (await getPool().connect());
  try {
    if (ownedClient) await client.query("BEGIN");
    const purchases = await listComputePurchases({
      start: rangeStart,
      end: rangeEnd,
      client,
    });
    const intervals = await listEgressIntervals({
      purchaseIds: purchases
        .filter(
          ({ description }) => description.resource_kind === "compute-egress",
        )
        .map(({ id }) => id),
      client,
    });
    const revenue = new Map<string, RevenueAggregate>();
    const usageByResource = new Map<string, UsageAggregate>();
    for (const purchase of purchases) {
      const period = purchasePeriod(purchase, rangeEnd);
      if (period == null) continue;
      const product = productForPurchase(purchase.description);
      const provider =
        `${purchase.description.provider ?? "unknown"}`.trim().toLowerCase() ||
        "unknown";
      if (!purchase.refunded) {
        const components = componentWeights(purchase.description);
        for (const allocation of purchaseDailyCents({
          purchase,
          period,
          intervals: intervals.get(purchase.id) ?? [],
        })) {
          const day = utcDay(allocation.day);
          if (day < rangeStart || day >= rangeEnd) continue;
          const componentCents = allocateIntegerByWeights(
            allocation.cents,
            components.map(({ weight }) => weight),
          );
          components.forEach(({ component }, index) => {
            addRevenue(revenue, {
              day: allocation.day,
              product,
              provider,
              cost_component: component,
              revenue_cents: componentCents[index],
              purchase_id: purchase.id,
            });
          });
        }
      }
      const resourceKind = purchase.description.resource_kind;
      if (
        purchase.description.billing_state !== "running" ||
        (resourceKind !== "project-host" && resourceKind !== "compute-vm")
      ) {
        continue;
      }
      for (
        let cursor = utcDay(period.start);
        cursor < period.end;
        cursor = nextDay(cursor)
      ) {
        if (cursor < rangeStart || cursor >= rangeEnd) continue;
        const seconds = overlapSeconds(
          period.start,
          period.end,
          cursor,
          nextDay(cursor),
        );
        if (seconds <= 0) continue;
        const day = dayKey(cursor);
        const resourceKey = [
          day,
          product,
          provider,
          purchase.description.host_id,
        ].join("\0");
        const previous = usageByResource.get(resourceKey);
        usageByResource.set(resourceKey, {
          day,
          product,
          provider,
          running_unit_seconds: Math.min(
            86_400,
            (previous?.running_unit_seconds ?? 0) + seconds,
          ),
          resource_ids: new Set([purchase.description.host_id]),
        });
      }
    }
    const usage = new Map<string, UsageAggregate>();
    for (const row of usageByResource.values()) {
      addUsage(usage, {
        day: row.day,
        product: row.product,
        provider: row.provider,
        running_unit_seconds: row.running_unit_seconds,
        resource_id: [...row.resource_ids][0],
      });
    }
    const bayId = getConfiguredBayId();
    await client.query(
      `DELETE FROM compute_revenue_daily
        WHERE bay_id=$1 AND day >= $2::date AND day < $3::date`,
      [bayId, rangeStart, rangeEnd],
    );
    await client.query(
      `DELETE FROM compute_usage_daily
        WHERE bay_id=$1 AND day >= $2::date AND day < $3::date`,
      [bayId, rangeStart, rangeEnd],
    );
    for (const row of revenue.values()) {
      if (row.revenue_cents === 0) continue;
      await client.query(
        `INSERT INTO compute_revenue_daily
          (day,bay_id,product,provider,cost_component,revenue_cents,
           purchase_count,updated_at)
         VALUES ($1::date,$2,$3,$4,$5,$6,$7,NOW())`,
        [
          row.day,
          bayId,
          row.product,
          row.provider,
          row.cost_component,
          row.revenue_cents,
          row.purchase_ids.size,
        ],
      );
    }
    for (const row of usage.values()) {
      await client.query(
        `INSERT INTO compute_usage_daily
          (day,bay_id,product,provider,running_unit_seconds,
           distinct_running_units,updated_at)
         VALUES ($1::date,$2,$3,$4,$5,$6,NOW())`,
        [
          row.day,
          bayId,
          row.product,
          row.provider,
          Math.round(row.running_unit_seconds),
          row.resource_ids.size,
        ],
      );
    }
    if (ownedClient) await client.query("COMMIT");
    return Math.round((rangeEnd.valueOf() - rangeStart.valueOf()) / DAY_MS);
  } catch (err) {
    if (ownedClient) await client.query("ROLLBACK");
    throw err;
  } finally {
    if (ownedClient) client.release();
  }
}

async function earliestComputeDay(client: Queryable): Promise<Date | null> {
  const { rows } = await client.query<{ day: Date | null }>(
    `SELECT MIN(COALESCE(period_start, time))::date AS day
       FROM purchases
      WHERE service='dedicated-host'
        AND description->>'type'='dedicated-host'`,
  );
  return rows[0]?.day == null ? null : utcDay(rows[0].day);
}

async function changedComputeRange({
  since,
  today,
  client,
}: {
  since: Date;
  today: Date;
  client: Queryable;
}): Promise<{ start: Date; end: Date } | null> {
  const { rows } = await client.query<{ start_day: Date; end_day: Date }>(
    `WITH changed AS (
       SELECT COALESCE(p.period_start, p.time)::date AS start_day,
              LEAST(COALESCE(p.period_end, $2), $2)::date AS end_day
         FROM purchases p
        WHERE p.service='dedicated-host'
          AND p.description->>'type'='dedicated-host'
          AND (p.time >= $1 OR p.period_end >= $1)
       UNION ALL
       SELECT COALESCE(original.period_start, original.time)::date,
              LEAST(COALESCE(original.period_end, $2), $2)::date
         FROM purchases refund
         JOIN purchases original
           ON refund.description->>'purchase_id' ~ '^[0-9]+$'
          AND (refund.description->>'purchase_id')::bigint=original.id
        WHERE refund.service='refund'
          AND refund.time >= $1
          AND original.service='dedicated-host'
       UNION ALL
       SELECT interval.started_at::date,
              LEAST(interval.ended_at, $2)::date
         FROM compute_egress_meter_intervals interval
        WHERE interval.created_at >= $1
     )
     SELECT MIN(start_day) AS start_day, MAX(end_day) AS end_day FROM changed`,
    [since, today],
  );
  const row = rows[0];
  if (row?.start_day == null || row.end_day == null) return null;
  const start = utcDay(row.start_day);
  const end = nextDay(utcDay(row.end_day));
  return start < today ? { start, end: end < today ? end : today } : null;
}

export async function maintainComputeRevenueAnalytics({
  now = new Date(),
  client: providedClient,
}: {
  now?: Date;
  client?: PoolClient;
} = {}): Promise<ComputeRevenueAnalyticsMaintenanceResult> {
  const today = utcDay(now);
  const yesterday = new Date(today.valueOf() - DAY_MS);
  const bayId = getConfiguredBayId();
  const ownedClient = providedClient == null;
  const client = providedClient ?? (await getPool().connect());
  try {
    if (ownedClient) await client.query("BEGIN");
    await client.query(
      "SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))",
      ["compute-revenue-analytics", bayId],
    );
    const { rows } = await client.query<{
      complete_through: Date | null;
      last_scanned_at: Date | null;
    }>(
      `SELECT complete_through, last_scanned_at
         FROM compute_revenue_analytics_state
        WHERE bay_id=$1
        FOR UPDATE`,
      [bayId],
    );
    const state = rows[0];
    let completeThrough = state?.complete_through
      ? utcDay(state.complete_through)
      : null;
    const ranges: Array<{ start: Date; end: Date }> = [];
    const earliest = await earliestComputeDay(client);
    const backfillStart = completeThrough
      ? nextDay(completeThrough)
      : earliest && earliest < today
        ? earliest
        : yesterday;
    if (backfillStart < today) {
      const backfillEnd = new Date(
        Math.min(
          today.valueOf(),
          backfillStart.valueOf() + MAX_BACKFILL_DAYS * DAY_MS,
        ),
      );
      ranges.push({ start: backfillStart, end: backfillEnd });
      completeThrough = new Date(backfillEnd.valueOf() - DAY_MS);
    }
    if (state?.last_scanned_at) {
      const changed = await changedComputeRange({
        // Re-read an overlap window so a source update that commits after the
        // previous scan cannot be missed merely because its business timestamp
        // was assigned before that scan completed.
        since: new Date(
          state.last_scanned_at.valueOf() - CHANGE_SCAN_OVERLAP_MS,
        ),
        today,
        client,
      });
      if (changed && completeThrough && changed.start <= completeThrough) {
        ranges.push({
          start: changed.start,
          end:
            changed.end <= nextDay(completeThrough)
              ? changed.end
              : nextDay(completeThrough),
        });
      }
    }
    if (completeThrough && completeThrough >= yesterday) {
      ranges.push({ start: yesterday, end: today });
    }
    let rebuiltDays = 0;
    const seen = new Set<string>();
    for (const range of ranges) {
      const key = `${dayKey(range.start)}:${dayKey(range.end)}`;
      if (seen.has(key) || range.start >= range.end) continue;
      seen.add(key);
      rebuiltDays += await rebuildComputeRevenueDays({
        ...range,
        client,
      });
    }
    completeThrough ??= yesterday;
    await client.query(
      `INSERT INTO compute_revenue_analytics_state
        (bay_id,complete_through,last_scanned_at,updated_at)
       VALUES ($1,$2::date,$3,NOW())
       ON CONFLICT (bay_id) DO UPDATE SET
         complete_through=EXCLUDED.complete_through,
         last_scanned_at=EXCLUDED.last_scanned_at,
         updated_at=NOW()`,
      [bayId, completeThrough, now],
    );
    if (ownedClient) await client.query("COMMIT");
    const result = {
      rebuilt_days: rebuiltDays,
      complete_through: dayKey(completeThrough),
    };
    logger.debug("compute revenue analytics maintenance complete", {
      bay_id: bayId,
      ...result,
    });
    return result;
  } catch (err) {
    if (ownedClient) await client.query("ROLLBACK");
    throw err;
  } finally {
    if (ownedClient) client.release();
  }
}
