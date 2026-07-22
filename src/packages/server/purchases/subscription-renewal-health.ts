/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { getServerSettings } from "@cocalc/database/settings/server-settings";
import getPool from "@cocalc/database/pool";
import adminAlert from "@cocalc/server/messages/admin-alert";

const DEFAULT_WARNING_MINUTES = 10;
const DEFAULT_CRITICAL_MINUTES = 24 * 60;
const ALERT_DEDUP_MINUTES = 24 * 60;
const MAX_ALERT_ROWS = 100;

interface DelayedRenewalRow {
  attempt_id: string;
  subscription_id: number;
  account_id: string;
  state: string;
  not_before: Date;
  age_minutes: number;
  attempt_count: number;
  payment_intent_id?: string;
  stripe_invoice_id?: string;
  last_error?: string;
}

export interface SubscriptionRenewalHealthThresholds {
  warningMinutes: number;
  criticalMinutes: number;
}

function positiveNumber(value: unknown): number | undefined {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return;
  }
  return parsed;
}

export function getSubscriptionRenewalHealthThresholds(
  maintenance: any,
): SubscriptionRenewalHealthThresholds {
  const warningMinutes =
    positiveNumber(maintenance?.renewal_warning_minutes) ??
    DEFAULT_WARNING_MINUTES;
  const criticalMinutes = Math.max(
    warningMinutes,
    positiveNumber(maintenance?.renewal_critical_minutes) ??
      DEFAULT_CRITICAL_MINUTES,
  );
  return { warningMinutes, criticalMinutes };
}

function markdownCell(value: unknown): string {
  return `${value ?? ""}`.replaceAll("|", "\\|").replaceAll("\n", " ");
}

function delayedRenewalTable(
  rows: DelayedRenewalRow[],
  criticalMinutes: number,
): string {
  const header =
    "| Severity | Age | Account | Subscription | Attempt | State | Tries | PaymentIntent | Last error |\n" +
    "| --- | ---: | --- | ---: | --- | --- | ---: | --- | --- |";
  const body = rows.slice(0, MAX_ALERT_ROWS).map((row) => {
    const severity =
      row.age_minutes >= criticalMinutes ? "CRITICAL" : "Warning";
    return `| ${severity} | ${Math.floor(row.age_minutes)}m | ${markdownCell(
      row.account_id,
    )} | ${row.subscription_id} | ${markdownCell(row.attempt_id)} | ${markdownCell(
      row.state,
    )} | ${row.attempt_count} | ${markdownCell(
      row.payment_intent_id,
    )} | ${markdownCell(row.last_error)} |`;
  });
  return [header, ...body].join("\n");
}

export async function alertDelayedSubscriptionRenewals(): Promise<number> {
  const { subscription_maintenance: maintenance } = await getServerSettings();
  const { warningMinutes, criticalMinutes } =
    getSubscriptionRenewalHealthThresholds(maintenance);
  const { rows } = await getPool().query<DelayedRenewalRow>(
    `SELECT id AS attempt_id,
            subscription_id,
            account_id,
            state,
            not_before,
            EXTRACT(EPOCH FROM (NOW() - not_before)) / 60 AS age_minutes,
            attempt_count,
            payment_intent_id,
            stripe_invoice_id,
            last_error
       FROM subscription_renewal_attempts
      WHERE state IN ('scheduled','processing')
        AND not_before <= NOW() - ($1 * INTERVAL '1 minute')
      ORDER BY not_before, subscription_id`,
    [warningMinutes],
  );
  if (rows.length === 0) {
    return 0;
  }
  const critical = rows.some(
    ({ age_minutes }) => Number(age_minutes) >= criticalMinutes,
  );
  const hidden = Math.max(0, rows.length - MAX_ALERT_ROWS);
  const body = `Automatic personal membership renewals are taking longer than expected.

- Affected renewals: ${rows.length}
- Oldest age: ${Math.floor(Number(rows[0].age_minutes))} minutes
- Warning threshold: ${warningMinutes} minutes
- Critical threshold: ${criticalMinutes} minutes

${delayedRenewalTable(rows, criticalMinutes)}
${hidden > 0 ? `\n${hidden} additional affected renewals are omitted.` : ""}`;
  await adminAlert({
    subject: critical
      ? "CRITICAL: Personal membership renewal processing is delayed"
      : "Personal membership renewal processing is delayed",
    body,
    dedupBySubject: true,
    dedupMinutes: ALERT_DEDUP_MINUTES,
  });
  return rows.length;
}
