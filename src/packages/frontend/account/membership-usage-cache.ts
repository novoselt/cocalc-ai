/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  AccountUsageOverview,
  AIUsageStatus,
  MembershipDetails,
} from "@cocalc/conat/hub/api/purchases";
import { webapp_client } from "@cocalc/frontend/webapp-client";
import {
  dispatchAccountUsageOverviewRefreshed,
  dispatchMembershipDetailsRefreshed,
} from "./membership-usage-events";

const WARNING_CACHE_MS = 45_000;
const WARNING_JITTER_MS = 15_000;

type CacheEntry<T> = {
  value: T;
  time: number;
};

const membershipDetailsCache = new Map<string, CacheEntry<MembershipDetails>>();
const membershipDetailsInflight = new Map<
  string,
  Promise<MembershipDetails | null>
>();
const accountUsageOverviewCache = new Map<
  string,
  CacheEntry<AccountUsageOverview>
>();
const accountUsageOverviewInflight = new Map<
  string,
  Promise<AccountUsageOverview | null>
>();
const aiUsageCache = new Map<string, CacheEntry<AIUsageStatus>>();
const aiUsageInflight = new Map<string, Promise<AIUsageStatus | null>>();

function isFresh<T>(entry: CacheEntry<T> | undefined, now: number): boolean {
  return entry != null && now - entry.time < WARNING_CACHE_MS;
}

export function shouldPollUsageWarnings(): boolean {
  return (
    typeof document === "undefined" || document.visibilityState !== "hidden"
  );
}

export function warningPollInterval(baseMs: number): number {
  return baseMs + Math.floor(Math.random() * WARNING_JITTER_MS);
}

export async function getWarningMembershipDetails(
  account_id: string,
): Promise<MembershipDetails | null> {
  const now = Date.now();
  const cached = membershipDetailsCache.get(account_id);
  if (isFresh(cached, now)) {
    return cached!.value;
  }
  const inflight = membershipDetailsInflight.get(account_id);
  if (inflight != null) {
    return await inflight;
  }
  const request = webapp_client.conat_client.hub.purchases
    .getMembershipDetails({
      refresh_usage_status: true,
    })
    .then((details) => {
      const next = (details as MembershipDetails) ?? null;
      if (next != null) {
        membershipDetailsCache.set(account_id, {
          value: next,
          time: Date.now(),
        });
        dispatchMembershipDetailsRefreshed(next, account_id);
      }
      return next;
    })
    .finally(() => {
      if (membershipDetailsInflight.get(account_id) === request) {
        membershipDetailsInflight.delete(account_id);
      }
    });
  membershipDetailsInflight.set(account_id, request);
  return await request;
}

export async function getWarningAccountUsageOverview(
  account_id: string,
): Promise<AccountUsageOverview | null> {
  const now = Date.now();
  const cached = accountUsageOverviewCache.get(account_id);
  if (isFresh(cached, now)) {
    return cached!.value;
  }
  const inflight = accountUsageOverviewInflight.get(account_id);
  if (inflight != null) {
    return await inflight;
  }
  const request = webapp_client.conat_client.hub.purchases
    .getAccountUsageOverview()
    .then((overview) => {
      const next = (overview as AccountUsageOverview) ?? null;
      if (next != null) {
        accountUsageOverviewCache.set(account_id, {
          value: next,
          time: Date.now(),
        });
        dispatchAccountUsageOverviewRefreshed(next, account_id);
      }
      return next;
    })
    .finally(() => {
      if (accountUsageOverviewInflight.get(account_id) === request) {
        accountUsageOverviewInflight.delete(account_id);
      }
    });
  accountUsageOverviewInflight.set(account_id, request);
  return await request;
}

export async function getWarningAIUsage(
  account_id: string,
): Promise<AIUsageStatus | null> {
  const now = Date.now();
  const cached = aiUsageCache.get(account_id);
  if (isFresh(cached, now)) {
    return cached!.value;
  }
  const inflight = aiUsageInflight.get(account_id);
  if (inflight != null) {
    return await inflight;
  }
  const request = webapp_client.conat_client.hub.purchases
    .getAIUsage({})
    .then((status) => {
      const next = (status as AIUsageStatus) ?? null;
      if (next != null) {
        aiUsageCache.set(account_id, { value: next, time: Date.now() });
      }
      return next;
    })
    .finally(() => {
      if (aiUsageInflight.get(account_id) === request) {
        aiUsageInflight.delete(account_id);
      }
    });
  aiUsageInflight.set(account_id, request);
  return await request;
}
