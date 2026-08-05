/*
 *  This file is part of CoCalc: Copyright © 2026, SageMath, Inc.
 *  License: MS-RSL – see https://github.com/sagemathinc/cocalc-ai/blob/master/LICENSE.md
 */

import { getServerSettings } from "@cocalc/database/settings/server-settings";
import type {
  SiteFundedCodexPoolStatus,
  SiteFundedCodexStatus,
} from "@cocalc/util/ai/site-funded-codex";
import { usdToMicrousd } from "@cocalc/util/ai/site-funded-codex";

type CostsPage = {
  data?: Array<{
    results?: Array<{
      amount?: { value?: number | string; currency?: string };
      project_id?: string | null;
    }>;
  }>;
  has_more?: boolean;
  next_page?: string | null;
};

export async function reconcileSiteFundedCodexCosts(
  pools: SiteFundedCodexPoolStatus[],
): Promise<NonNullable<SiteFundedCodexStatus["reconciliation"]>> {
  const checkedAt = new Date().toISOString();
  const periodStart =
    pools[0]?.periodStart ??
    new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const periodEnd = pools[0]?.periodEnd ?? new Date().toISOString();
  const globalPool = pools.find(
    ({ poolId }) => poolId === "site-funded-codex-global",
  );
  const localCommittedMicrousd =
    globalPool?.committedMicrousd ??
    pools.reduce((sum, pool) => sum + pool.committedMicrousd, 0);
  const settings = (await getServerSettings()) as Record<string, unknown>;
  const adminKey =
    `${settings.site_funded_codex_openai_admin_key ?? ""}`.trim();
  const projectId = `${
    settings.site_funded_codex_openai_project_id ?? ""
  }`.trim();
  const base = {
    checkedAt,
    periodStart,
    periodEnd,
    localCommittedMicrousd,
    projectId: projectId || undefined,
  };
  if (!adminKey || !projectId) {
    return {
      ...base,
      available: false,
      reason:
        "Configure a dedicated OpenAI project ID and organization admin key to enable provider reconciliation.",
    };
  }

  let providerCostMicrousd = 0;
  let page: string | undefined;
  do {
    const url = new URL("https://api.openai.com/v1/organization/costs");
    url.searchParams.set(
      "start_time",
      `${Math.floor(new Date(periodStart).getTime() / 1_000)}`,
    );
    url.searchParams.set(
      "end_time",
      `${Math.floor(Math.min(Date.now(), new Date(periodEnd).getTime()) / 1_000)}`,
    );
    url.searchParams.set("bucket_width", "1d");
    url.searchParams.set("limit", "14");
    url.searchParams.append("project_ids", projectId);
    if (page) url.searchParams.set("page", page);
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${adminKey}`,
        "Content-Type": "application/json",
      },
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 500);
      return {
        ...base,
        available: false,
        reason: `OpenAI Costs API returned ${response.status}: ${detail}`,
      };
    }
    const body = (await response.json()) as CostsPage;
    for (const bucket of body.data ?? []) {
      for (const result of bucket.results ?? []) {
        if (result.amount?.currency !== "usd") continue;
        if (result.project_id && result.project_id !== projectId) continue;
        providerCostMicrousd += usdToMicrousd(`${result.amount?.value ?? 0}`);
      }
    }
    page = body.has_more ? (body.next_page ?? undefined) : undefined;
  } while (page);

  const discrepancyMicrousd = providerCostMicrousd - localCommittedMicrousd;
  return {
    ...base,
    available: true,
    providerCostMicrousd,
    discrepancyMicrousd,
    discrepancyPercent:
      providerCostMicrousd > 0
        ? (discrepancyMicrousd / providerCostMicrousd) * 100
        : localCommittedMicrousd === 0
          ? 0
          : -100,
  };
}
