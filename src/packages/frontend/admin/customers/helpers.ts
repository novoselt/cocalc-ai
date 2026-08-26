/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { CrmActivity, CrmMutationResult } from "@cocalc/util/crm";

type MutationPreview = Extract<CrmMutationResult<unknown>, { preview: true }>;

export function crmMutationContext({
  browserId,
  commit,
  previous,
  reason,
}: {
  browserId: string;
  commit: boolean;
  previous?: MutationPreview;
  reason: string;
}) {
  return {
    browser_id: browserId,
    commit,
    expected_version: previous?.expected_version,
    idempotency_key: previous?.idempotency_key,
    reason,
    source: "admin-ui" as const,
  };
}

function normalizeTimelineSearch(value: unknown): string {
  return `${value ?? ""}`
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function filterCrmActivities(
  activities: readonly CrmActivity[],
  query: string,
): CrmActivity[] {
  const needle = normalizeTimelineSearch(query);
  if (!needle) return [...activities];
  return activities.filter((activity) => {
    const searchable = normalizeTimelineSearch(
      [
        activity.summary,
        activity.details,
        activity.kind,
        activity.source,
        activity.source_id,
        activity.zendesk_ticket_id,
        activity.occurred_at,
      ].join(" "),
    );
    return searchable.includes(needle);
  });
}

export function safeExternalHttpUrl(
  value: string | null | undefined,
): string | undefined {
  if (!value) return;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return;
    if (!url.hostname || url.username || url.password) return;
    return url.toString();
  } catch {
    return;
  }
}
