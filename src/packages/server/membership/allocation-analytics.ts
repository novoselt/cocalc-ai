/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool, {
  getTransactionClient,
  type PoolClient,
} from "@cocalc/database/pool";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import {
  moneyRoundToCents,
  toDecimal,
  type MoneyValue,
} from "@cocalc/util/money";

type Queryable = Pick<PoolClient, "query">;

export type MembershipAllocationChannel =
  | "personal"
  | "direct-student"
  | "course"
  | "team"
  | "site";

export type MembershipAllocationSourceKind =
  | "purchase"
  | "refund"
  | "trial"
  | "plan-change-credit"
  | "assignment"
  | "correction"
  | "external-import";

export type MembershipAllocationBillingInterval =
  | "trial"
  | "month"
  | "year"
  | "fixed";

export type MembershipAllocationLifecycle =
  | "trial"
  | "first_paid"
  | "renewal"
  | "plan_change";

export type MembershipAllocationTierChange =
  | "none"
  | "upgrade"
  | "downgrade"
  | "same";

export interface MembershipAllocationFact {
  fact_key: string;
  occurred_at: Date;
  bay_id: string;
  account_id: string;
  channel: MembershipAllocationChannel;
  source_kind: MembershipAllocationSourceKind;
  membership_class: string;
  billing_interval: MembershipAllocationBillingInterval;
  lifecycle: MembershipAllocationLifecycle;
  previous_membership_class?: string | null;
  previous_billing_interval?: MembershipAllocationBillingInterval | null;
  tier_change: MembershipAllocationTierChange;
  allocation_start: Date | string;
  allocation_end: Date | string;
  active_memberships: number;
  purchased_capacity: number;
  revenue_cents: number | string;
  purchase_id?: number | null;
  subscription_id?: number | null;
  reverses_fact_key?: string | null;
}

export interface RecordMembershipAllocationFactOptions extends Omit<
  MembershipAllocationFact,
  | "occurred_at"
  | "bay_id"
  | "tier_change"
  | "active_memberships"
  | "purchased_capacity"
  | "revenue_cents"
> {
  occurred_at?: Date;
  bay_id?: string;
  tier_change?: MembershipAllocationTierChange;
  active_memberships?: number;
  purchased_capacity?: number;
  revenue?: MoneyValue;
  client?: PoolClient;
}

export interface DailyCentAllocation {
  day: string;
  revenue_cents: number;
}

const MAX_PROJECT_BATCH = 1000;

function queryable(client?: Queryable): Queryable {
  return client ?? getPool("medium");
}

function utcDateKey(value: Date | string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    throw Error(`invalid membership allocation date: ${value}`);
  }
  return date.toISOString().slice(0, 10);
}

function utcDayNumber(value: string): number {
  return Date.parse(`${value}T00:00:00.000Z`) / (24 * 60 * 60 * 1000);
}

function dateFromUtcDayNumber(value: number): string {
  return new Date(value * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function allocateWholeCentsByDay({
  allocation_start,
  allocation_end,
  revenue_cents,
}: {
  allocation_start: Date | string;
  allocation_end: Date | string;
  revenue_cents: number;
}): DailyCentAllocation[] {
  if (!Number.isSafeInteger(revenue_cents)) {
    throw Error(
      "membership allocation revenue must be whole safe-integer cents",
    );
  }
  const start = utcDateKey(allocation_start);
  const end = utcDateKey(allocation_end);
  const startDay = utcDayNumber(start);
  const endDay = utcDayNumber(end);
  const days = endDay - startDay;
  if (!Number.isSafeInteger(days) || days <= 0) {
    throw Error("membership allocation must include at least one UTC day");
  }
  const sign = revenue_cents < 0 ? -1 : 1;
  const absolute = Math.abs(revenue_cents);
  const base = Math.floor(absolute / days);
  const remainder = absolute % days;
  return Array.from({ length: days }, (_, index) => ({
    day: dateFromUtcDayNumber(startDay + index),
    revenue_cents: sign * (base + (index < remainder ? 1 : 0)),
  }));
}

function moneyToWholeCents(value: MoneyValue): number {
  const amount = toDecimal(value);
  const rounded = moneyRoundToCents(amount);
  if (!amount.eq(rounded)) {
    throw Error("membership allocation revenue must be in whole cents");
  }
  const cents = rounded.mul(100).toNumber();
  if (!Number.isSafeInteger(cents)) {
    throw Error("membership allocation revenue is outside the supported range");
  }
  return cents;
}

function integerMeasure(value: number | undefined, name: string): number {
  const normalized = value ?? 0;
  if (!Number.isSafeInteger(normalized)) {
    throw Error(`${name} must be a safe integer`);
  }
  return normalized;
}

export async function recordMembershipAllocationFact({
  fact_key,
  occurred_at = new Date(),
  bay_id = getConfiguredBayId(),
  account_id,
  channel,
  source_kind,
  membership_class,
  billing_interval,
  lifecycle,
  previous_membership_class = null,
  previous_billing_interval = null,
  tier_change = "none",
  allocation_start,
  allocation_end,
  active_memberships,
  purchased_capacity,
  revenue = 0,
  purchase_id = null,
  subscription_id = null,
  reverses_fact_key = null,
  client,
}: RecordMembershipAllocationFactOptions): Promise<boolean> {
  const start = utcDateKey(allocation_start);
  const end = utcDateKey(allocation_end);
  if (utcDayNumber(end) <= utcDayNumber(start)) {
    throw Error("membership allocation must include at least one UTC day");
  }
  const activeMemberships = integerMeasure(
    active_memberships,
    "active_memberships",
  );
  const purchasedCapacity = integerMeasure(
    purchased_capacity,
    "purchased_capacity",
  );
  const revenueCents = moneyToWholeCents(revenue);
  if (
    activeMemberships === 0 &&
    purchasedCapacity === 0 &&
    revenueCents === 0
  ) {
    throw Error("membership allocation fact must change at least one measure");
  }
  const result = await queryable(client).query(
    `INSERT INTO membership_allocation_facts
       (fact_key, occurred_at, bay_id, account_id, channel, source_kind,
        membership_class, billing_interval, lifecycle,
        previous_membership_class, previous_billing_interval, tier_change,
        allocation_start, allocation_end, active_memberships,
        purchased_capacity, revenue_cents, purchase_id, subscription_id,
        reverses_fact_key)
     VALUES
       ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13::date,$14::date,
        $15,$16,$17,$18,$19,$20)
     ON CONFLICT (fact_key) DO NOTHING`,
    [
      fact_key,
      occurred_at,
      bay_id,
      account_id,
      channel,
      source_kind,
      membership_class,
      billing_interval,
      lifecycle,
      previous_membership_class,
      previous_billing_interval,
      tier_change,
      start,
      end,
      activeMemberships,
      purchasedCapacity,
      revenueCents,
      purchase_id,
      subscription_id,
      reverses_fact_key,
    ],
  );
  return result.rowCount === 1;
}

export async function projectMembershipAllocationFact({
  fact_key,
  client,
}: {
  fact_key: string;
  client: PoolClient;
}): Promise<boolean> {
  const claimed = await client.query(
    `INSERT INTO membership_allocation_projections (fact_key, projected_at)
     VALUES ($1, NOW())
     ON CONFLICT (fact_key) DO NOTHING`,
    [fact_key],
  );
  if (claimed.rowCount !== 1) return false;

  const { rows } = await client.query<MembershipAllocationFact>(
    `SELECT fact_key, occurred_at, bay_id, account_id, channel, source_kind,
            membership_class, billing_interval, lifecycle,
            previous_membership_class, previous_billing_interval, tier_change,
            allocation_start, allocation_end, active_memberships,
            purchased_capacity, revenue_cents, purchase_id, subscription_id,
            reverses_fact_key
       FROM membership_allocation_facts
      WHERE fact_key=$1`,
    [fact_key],
  );
  const fact = rows[0];
  if (!fact) {
    throw Error(`membership allocation fact ${fact_key} does not exist`);
  }
  const allocations = allocateWholeCentsByDay({
    allocation_start: fact.allocation_start,
    allocation_end: fact.allocation_end,
    revenue_cents: Number(fact.revenue_cents),
  });
  await client.query(
    `INSERT INTO membership_daily_allocations
       (day, bay_id, channel, source_kind, membership_class,
        billing_interval, lifecycle, previous_membership_class,
        previous_billing_interval, tier_change, active_memberships,
        purchased_capacity, revenue_cents, fact_count)
     SELECT day::date, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            $12, $13, revenue_cents, 1
       FROM UNNEST($1::text[], $2::bigint[]) AS rows(day, revenue_cents)
     ON CONFLICT
       (day, bay_id, channel, source_kind, membership_class,
        billing_interval, lifecycle, previous_membership_class,
        previous_billing_interval, tier_change)
     DO UPDATE SET
       active_memberships = membership_daily_allocations.active_memberships +
                            EXCLUDED.active_memberships,
       purchased_capacity = membership_daily_allocations.purchased_capacity +
                            EXCLUDED.purchased_capacity,
       revenue_cents = membership_daily_allocations.revenue_cents +
                       EXCLUDED.revenue_cents,
       fact_count = membership_daily_allocations.fact_count + 1,
       updated_at = NOW()`,
    [
      allocations.map(({ day }) => day),
      allocations.map(({ revenue_cents }) => revenue_cents),
      fact.bay_id,
      fact.channel,
      fact.source_kind,
      fact.membership_class,
      fact.billing_interval,
      fact.lifecycle,
      fact.previous_membership_class ?? "",
      fact.previous_billing_interval ?? "",
      fact.tier_change,
      fact.active_memberships,
      fact.purchased_capacity,
    ],
  );
  return true;
}

export async function projectOutstandingMembershipAllocationFacts({
  limit = 100,
}: {
  limit?: number;
} = {}): Promise<number> {
  const maxRows = Math.max(
    1,
    Math.min(MAX_PROJECT_BATCH, Math.floor(Number(limit) || 100)),
  );
  const { rows } = await getPool("medium").query<{ fact_key: string }>(
    `SELECT f.fact_key
       FROM membership_allocation_facts f
       LEFT JOIN membership_allocation_projections p
         ON p.fact_key=f.fact_key
      WHERE p.fact_key IS NULL
      ORDER BY f.occurred_at, f.fact_key
      LIMIT $1`,
    [maxRows],
  );
  let projected = 0;
  for (const { fact_key } of rows) {
    const client = await getTransactionClient();
    try {
      if (await projectMembershipAllocationFact({ fact_key, client })) {
        projected += 1;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
  return projected;
}
