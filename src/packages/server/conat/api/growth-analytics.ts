/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  GrowthRangeQuery,
  GrowthEventInput,
} from "@cocalc/conat/hub/api/growth-analytics";
import isAdmin from "@cocalc/server/accounts/is-admin";
import { ingestGrowthEvent } from "@cocalc/server/growth-analytics/ingest";
import * as queries from "@cocalc/server/growth-analytics/queries";

const BROWSER_EVENT_NAMES = new Set([
  "first_project_flow_seen",
  "project_create_started",
  "project_ready",
  "project_entered",
  "project_surface_visible",
  "app_foreground",
  "project_engaged",
  "project_work",
  "ai_prompt_submitted",
  "guided_activation_done",
  "guided_activation_abandoned",
  "first_self_directed_work",
]);

async function requireAdmin(accountId?: string): Promise<void> {
  if (!accountId || !(await isAdmin(accountId))) {
    throw Object.assign(new Error("admin privileges required"), { code: 403 });
  }
}

export async function recordEvent({
  account_id,
  event,
}: {
  account_id?: string;
  event: GrowthEventInput;
}) {
  if (!account_id) throw Error("must be signed in");
  if (!BROWSER_EVENT_NAMES.has(event.event_name)) {
    throw Error("event_name is not accepted from a browser");
  }
  return await ingestGrowthEvent({
    account_id,
    event: {
      ...event,
      occurred_at: new Date().toISOString(),
      source_component: "browser",
      experiment: undefined,
      variant: undefined,
      properties: {
        source_confidence: "browser",
        ...(event.properties?.action_category
          ? { action_category: event.properties.action_category }
          : {}),
        ...(event.properties?.onboarding_path
          ? { onboarding_path: event.properties.onboarding_path }
          : {}),
        ...(event.properties?.outcome
          ? { outcome: event.properties.outcome }
          : {}),
      },
    },
  });
}

export async function getGrowthSummary(
  opts: GrowthRangeQuery & { account_id?: string } = {},
) {
  await requireAdmin(opts.account_id);
  return await queries.getGrowthSummary(opts);
}

export async function getGrowthFunnel(
  opts: GrowthRangeQuery & { account_id?: string } = {},
) {
  await requireAdmin(opts.account_id);
  return await queries.getGrowthFunnel(opts);
}

export async function getActiveUserSeries(
  opts: GrowthRangeQuery & { account_id?: string } = {},
) {
  await requireAdmin(opts.account_id);
  return await queries.getActiveUserSeries(opts);
}

export async function getRetentionMatrix(
  opts: GrowthRangeQuery & {
    account_id?: string;
    cohort_grain?: "day" | "week";
  } = {},
) {
  await requireAdmin(opts.account_id);
  return await queries.getRetentionMatrix(opts);
}

export async function getWeeklyGrowthAccounting(
  opts: GrowthRangeQuery & { account_id?: string } = {},
) {
  await requireAdmin(opts.account_id);
  return await queries.getWeeklyGrowthAccounting(opts);
}

export async function getGrowthDataHealth({
  account_id,
}: {
  account_id?: string;
} = {}) {
  await requireAdmin(account_id);
  return await queries.getGrowthDataHealth();
}

export async function getGrowthDashboard(
  opts: GrowthRangeQuery & {
    account_id?: string;
    cohort_grain?: "day" | "week";
  } = {},
) {
  await requireAdmin(opts.account_id);
  return await queries.getGrowthDashboard(opts);
}
