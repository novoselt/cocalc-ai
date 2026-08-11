/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { createHash } from "node:crypto";
import type {
  GrowthActionCategory,
  GrowthEventName,
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
const BROWSER_ACTION_CATEGORIES = new Set<GrowthActionCategory>([
  "jupyter_execute",
  "terminal_submit",
  "editor_modify",
  "editor_save",
  "ai_prompt",
  "user_compute",
]);
const MINUTE_MS = 60_000;

function browserEventWindowMs(eventName: GrowthEventName): number {
  if (eventName === "app_foreground") return 60 * MINUTE_MS;
  if (eventName === "project_work" || eventName === "ai_prompt_submitted") {
    return 5 * MINUTE_MS;
  }
  return 30 * MINUTE_MS;
}

export function browserGrowthEventId({
  accountId,
  eventName,
  actionCategory,
  now,
}: {
  accountId: string;
  eventName: GrowthEventName;
  actionCategory?: GrowthActionCategory;
  now: Date;
}): string {
  const bucket = Math.floor(now.getTime() / browserEventWindowMs(eventName));
  const bytes = Buffer.from(
    createHash("sha256")
      .update(`${accountId}:${eventName}:${actionCategory ?? ""}:${bucket}`)
      .digest()
      .subarray(0, 16),
  );
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return (
    `${hex.slice(0, 8)}-${hex.slice(8, 12)}-` +
    `${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  );
}

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
  const actionCategory = event.properties?.action_category;
  if (
    actionCategory != null &&
    !BROWSER_ACTION_CATEGORIES.has(actionCategory as GrowthActionCategory)
  ) {
    throw Error("action_category is not accepted from a browser");
  }
  const now = new Date();
  return await ingestGrowthEvent({
    account_id,
    event: {
      ...event,
      event_id: browserGrowthEventId({
        accountId: account_id,
        eventName: event.event_name,
        actionCategory,
        now,
      }),
      occurred_at: now.toISOString(),
      source_component: "browser",
      experiment: undefined,
      variant: undefined,
      properties: {
        source_confidence: "browser",
        ...(actionCategory ? { action_category: actionCategory } : {}),
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
