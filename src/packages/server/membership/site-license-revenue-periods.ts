/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool, { type PoolClient } from "@cocalc/database/pool";
import isAdmin from "@cocalc/server/accounts/is-admin";
import type { SiteLicenseRevenuePeriod } from "@cocalc/conat/hub/api/purchases";
import { isValidUUID, uuid } from "@cocalc/util/misc";

import { ensureSiteLicenseSchema } from "./site-licenses";

type RevenuePeriodRow = Omit<
  SiteLicenseRevenuePeriod,
  "amount_cents" | "starts_on" | "ends_on" | "created" | "updated"
> & {
  amount_cents: number | string;
  starts_on: Date | string;
  ends_on: Date | string;
  created?: Date | string;
  updated?: Date | string;
};

type RevenuePeriodSnapshot = Pick<
  SiteLicenseRevenuePeriod,
  | "id"
  | "site_license_id"
  | "starts_on"
  | "ends_on"
  | "amount_cents"
  | "invoice_number"
  | "notes"
  | "metadata"
>;

function requireUuid(value: string, name: string): string {
  const normalized = `${value ?? ""}`.trim();
  if (!isValidUUID(normalized)) {
    throw Error(`${name} must be a valid uuid`);
  }
  return normalized;
}

function utcDay(value: Date | string, name: string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.valueOf())) {
    throw Error(`${name} must be a valid date`);
  }
  return date.toISOString().slice(0, 10);
}

function optionalText(value?: string | null): string | null {
  const normalized = `${value ?? ""}`.trim();
  return normalized || null;
}

function normalizeMetadata(
  value?: Record<string, unknown> | null,
): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function normalizeRow(row: RevenuePeriodRow): SiteLicenseRevenuePeriod {
  const amountCents = Number(row.amount_cents);
  if (!Number.isSafeInteger(amountCents)) {
    throw Error("site-license revenue amount is outside the supported range");
  }
  return {
    ...row,
    starts_on: utcDay(row.starts_on, "starts_on"),
    ends_on: utcDay(row.ends_on, "ends_on"),
    amount_cents: amountCents,
    invoice_number: row.invoice_number ?? null,
    notes: row.notes ?? null,
    metadata: normalizeMetadata(row.metadata),
    created: row.created == null ? undefined : new Date(row.created),
    updated: row.updated == null ? undefined : new Date(row.updated),
  };
}

function snapshot(period: SiteLicenseRevenuePeriod): RevenuePeriodSnapshot {
  return {
    id: period.id,
    site_license_id: period.site_license_id,
    starts_on: period.starts_on,
    ends_on: period.ends_on,
    amount_cents: period.amount_cents,
    invoice_number: period.invoice_number ?? null,
    notes: period.notes ?? null,
    metadata: period.metadata ?? {},
  };
}

async function assertAdmin({
  actor_account_id,
  trusted_admin,
}: {
  actor_account_id: string;
  trusted_admin?: boolean;
}): Promise<void> {
  if (!trusted_admin && !(await isAdmin(actor_account_id))) {
    throw Error("must be an admin");
  }
}

async function assertSiteLicenseExists({
  site_license_id,
  client,
}: {
  site_license_id: string;
  client: PoolClient;
}): Promise<void> {
  const { rows } = await client.query(
    "SELECT 1 FROM site_licenses WHERE id=$1",
    [site_license_id],
  );
  if (!rows[0]) {
    throw Error("site license not found");
  }
}

async function getPeriodForUpdate({
  site_license_id,
  period_id,
  client,
}: {
  site_license_id: string;
  period_id: string;
  client: PoolClient;
}): Promise<SiteLicenseRevenuePeriod | undefined> {
  const { rows } = await client.query<RevenuePeriodRow>(
    `SELECT *
       FROM site_license_revenue_periods
      WHERE id=$1 AND site_license_id=$2
      FOR UPDATE`,
    [period_id, site_license_id],
  );
  return rows[0] ? normalizeRow(rows[0]) : undefined;
}

async function recordAudit({
  site_license_id,
  period_id,
  action,
  actor_account_id,
  before,
  after,
  client,
}: {
  site_license_id: string;
  period_id: string;
  action: "created" | "updated" | "deleted";
  actor_account_id: string;
  before?: RevenuePeriodSnapshot;
  after?: RevenuePeriodSnapshot;
  client: PoolClient;
}): Promise<void> {
  await client.query(
    `INSERT INTO site_license_revenue_period_audit_log
       (id, site_license_id, period_id, action, actor_account_id,
        before_value, after_value)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb)`,
    [
      uuid(),
      site_license_id,
      period_id,
      action,
      actor_account_id,
      before == null ? null : JSON.stringify(before),
      after == null ? null : JSON.stringify(after),
    ],
  );
}

export async function listSiteLicenseRevenuePeriods({
  actor_account_id,
  site_license_id,
  trusted_admin = false,
}: {
  actor_account_id: string;
  site_license_id: string;
  trusted_admin?: boolean;
}): Promise<SiteLicenseRevenuePeriod[]> {
  const actorAccountId = requireUuid(actor_account_id, "actor_account_id");
  const siteLicenseId = requireUuid(site_license_id, "site_license_id");
  await assertAdmin({ actor_account_id: actorAccountId, trusted_admin });
  await ensureSiteLicenseSchema();
  const { rows } = await getPool().query<RevenuePeriodRow>(
    `SELECT *
       FROM site_license_revenue_periods
      WHERE site_license_id=$1
      ORDER BY starts_on DESC, ends_on DESC, created DESC`,
    [siteLicenseId],
  );
  return rows.map(normalizeRow);
}

export async function saveSiteLicenseRevenuePeriod({
  actor_account_id,
  site_license_id,
  period_id,
  starts_on,
  ends_on,
  amount_cents,
  invoice_number,
  notes,
  metadata,
  trusted_admin = false,
}: {
  actor_account_id: string;
  site_license_id: string;
  period_id?: string;
  starts_on: Date | string;
  ends_on: Date | string;
  amount_cents: number;
  invoice_number?: string | null;
  notes?: string | null;
  metadata?: Record<string, unknown> | null;
  trusted_admin?: boolean;
}): Promise<SiteLicenseRevenuePeriod> {
  const actorAccountId = requireUuid(actor_account_id, "actor_account_id");
  const siteLicenseId = requireUuid(site_license_id, "site_license_id");
  const periodId = period_id ? requireUuid(period_id, "period_id") : uuid();
  const startsOn = utcDay(starts_on, "starts_on");
  const endsOn = utcDay(ends_on, "ends_on");
  if (endsOn < startsOn) {
    throw Error("ends_on must be on or after starts_on");
  }
  if (!Number.isSafeInteger(amount_cents) || amount_cents < 0) {
    throw Error("amount_cents must be a nonnegative whole-cent amount");
  }
  await assertAdmin({ actor_account_id: actorAccountId, trusted_admin });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await ensureSiteLicenseSchema(client);
    await assertSiteLicenseExists({ site_license_id: siteLicenseId, client });
    const before = period_id
      ? await getPeriodForUpdate({
          site_license_id: siteLicenseId,
          period_id: periodId,
          client,
        })
      : undefined;
    if (period_id && !before) {
      throw Error("site-license revenue period not found");
    }
    const { rows } = await client.query<RevenuePeriodRow>(
      `INSERT INTO site_license_revenue_periods
         (id, site_license_id, starts_on, ends_on, amount_cents,
          invoice_number, notes, metadata, created_by_account_id,
          updated_by_account_id, created, updated)
       VALUES ($1,$2,$3::date,$4::date,$5,$6,$7,$8::jsonb,$9,$9,NOW(),NOW())
       ON CONFLICT (id) DO UPDATE SET
         starts_on=EXCLUDED.starts_on,
         ends_on=EXCLUDED.ends_on,
         amount_cents=EXCLUDED.amount_cents,
         invoice_number=EXCLUDED.invoice_number,
         notes=EXCLUDED.notes,
         metadata=EXCLUDED.metadata,
         updated_by_account_id=EXCLUDED.updated_by_account_id,
         updated=NOW()
       WHERE site_license_revenue_periods.site_license_id=EXCLUDED.site_license_id
       RETURNING *`,
      [
        periodId,
        siteLicenseId,
        startsOn,
        endsOn,
        amount_cents,
        optionalText(invoice_number),
        optionalText(notes),
        JSON.stringify(normalizeMetadata(metadata)),
        actorAccountId,
      ],
    );
    const saved = rows[0] ? normalizeRow(rows[0]) : undefined;
    if (!saved) {
      throw Error("site-license revenue period belongs to another license");
    }
    await recordAudit({
      site_license_id: siteLicenseId,
      period_id: periodId,
      action: before ? "updated" : "created",
      actor_account_id: actorAccountId,
      before: before ? snapshot(before) : undefined,
      after: snapshot(saved),
      client,
    });
    await client.query("COMMIT");
    return saved;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function deleteSiteLicenseRevenuePeriod({
  actor_account_id,
  site_license_id,
  period_id,
  trusted_admin = false,
}: {
  actor_account_id: string;
  site_license_id: string;
  period_id: string;
  trusted_admin?: boolean;
}): Promise<{ deleted: boolean }> {
  const actorAccountId = requireUuid(actor_account_id, "actor_account_id");
  const siteLicenseId = requireUuid(site_license_id, "site_license_id");
  const periodId = requireUuid(period_id, "period_id");
  await assertAdmin({ actor_account_id: actorAccountId, trusted_admin });

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await ensureSiteLicenseSchema(client);
    const before = await getPeriodForUpdate({
      site_license_id: siteLicenseId,
      period_id: periodId,
      client,
    });
    if (!before) {
      await client.query("COMMIT");
      return { deleted: false };
    }
    await client.query(
      "DELETE FROM site_license_revenue_periods WHERE id=$1 AND site_license_id=$2",
      [periodId, siteLicenseId],
    );
    await recordAudit({
      site_license_id: siteLicenseId,
      period_id: periodId,
      action: "deleted",
      actor_account_id: actorAccountId,
      before: snapshot(before),
      client,
    });
    await client.query("COMMIT");
    return { deleted: true };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
