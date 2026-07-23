/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ManagedProjectEgressCategory } from "@cocalc/server/membership/managed-egress";
import {
  getManagedEgressCategoryUsageForAccount,
  getManagedEgressUsageForAccount,
  getProjectUsageAccountId,
} from "@cocalc/server/membership/managed-egress";
import { getEffectiveMembershipUsageLimits } from "@cocalc/server/membership/effective-limits";
import { resolveMembershipForAccount } from "@cocalc/server/membership/resolve";
import LRU from "lru-cache";

export const DEFAULT_CONTROL_PLANE_EGRESS_5H_BYTES = 1_000_000_000;
export const DEFAULT_CONTROL_PLANE_EGRESS_7D_BYTES = 10_000_000_000;
const POLICY_CACHE_TTL_MS = 30_000;

const policyCache = new LRU<string, Promise<ManagedProjectEgressPolicy>>({
  max: 20_000,
  ttl: POLICY_CACHE_TTL_MS,
});

function positiveIntegerEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function getControlPlaneEgressLimits(): {
  egress_5h_bytes: number;
  egress_7d_bytes: number;
} {
  return {
    egress_5h_bytes: positiveIntegerEnv(
      "COCALC_CONTROL_PLANE_EGRESS_5H_BYTES",
      DEFAULT_CONTROL_PLANE_EGRESS_5H_BYTES,
    ),
    egress_7d_bytes: positiveIntegerEnv(
      "COCALC_CONTROL_PLANE_EGRESS_7D_BYTES",
      DEFAULT_CONTROL_PLANE_EGRESS_7D_BYTES,
    ),
  };
}

export interface ManagedProjectEgressPolicy {
  account_id?: string;
  category: ManagedProjectEgressCategory;
  allowed: boolean;
  blocked_by?: "5h" | "7d";
  managed_egress_5h_bytes?: number;
  managed_egress_7d_bytes?: number;
  egress_5h_bytes?: number;
  egress_7d_bytes?: number;
  managed_egress_categories_5h_bytes?: Record<string, number>;
  managed_egress_categories_7d_bytes?: Record<string, number>;
}

async function computeManagedProjectEgressPolicy({
  account_id,
  category,
}: {
  account_id: string;
  category: ManagedProjectEgressCategory;
}): Promise<ManagedProjectEgressPolicy> {
  if (category === "control-plane-conat") {
    const { egress_5h_bytes, egress_7d_bytes } = getControlPlaneEgressLimits();
    const usage = await getManagedEgressCategoryUsageForAccount({
      account_id,
      category,
    });
    const blocked_by =
      usage.bytes_5h > egress_5h_bytes
        ? "5h"
        : usage.bytes_7d > egress_7d_bytes
          ? "7d"
          : undefined;
    return {
      account_id,
      category,
      allowed: blocked_by == null,
      blocked_by,
      managed_egress_5h_bytes: usage.bytes_5h,
      managed_egress_7d_bytes: usage.bytes_7d,
      egress_5h_bytes,
      egress_7d_bytes,
      managed_egress_categories_5h_bytes: {
        "control-plane-conat": usage.bytes_5h,
      },
      managed_egress_categories_7d_bytes: {
        "control-plane-conat": usage.bytes_7d,
      },
    };
  }
  const resolution = await resolveMembershipForAccount(account_id);
  const effectiveLimits = getEffectiveMembershipUsageLimits(resolution);
  const egress_5h_bytes = effectiveLimits.egress_5h_bytes;
  const egress_7d_bytes = effectiveLimits.egress_7d_bytes;
  const usage = await getManagedEgressUsageForAccount({
    account_id,
    limit5h: egress_5h_bytes,
    limit7d: egress_7d_bytes,
  });
  const blocked_by = usage.over_managed_egress_5h
    ? "5h"
    : usage.over_managed_egress_7d
      ? "7d"
      : undefined;
  return {
    account_id,
    category,
    allowed: blocked_by == null,
    blocked_by,
    managed_egress_5h_bytes: usage.managed_egress_5h_bytes,
    managed_egress_7d_bytes: usage.managed_egress_7d_bytes,
    egress_5h_bytes,
    egress_7d_bytes,
    managed_egress_categories_5h_bytes:
      usage.managed_egress_categories_5h_bytes,
    managed_egress_categories_7d_bytes:
      usage.managed_egress_categories_7d_bytes,
  };
}

export async function getManagedProjectEgressPolicy(opts: {
  account_id?: string;
  project_id?: string;
  category: ManagedProjectEgressCategory;
}): Promise<ManagedProjectEgressPolicy> {
  const project_id = `${opts.project_id ?? ""}`.trim() || undefined;
  const account_id =
    `${opts.account_id ?? ""}`.trim() ||
    (project_id ? await getProjectUsageAccountId(project_id) : undefined);
  if (!account_id) {
    return {
      category: opts.category,
      allowed: true,
    };
  }
  const key = `${account_id}:${opts.category}`;
  const cached = policyCache.get(key);
  if (cached) return await cached;
  const value = computeManagedProjectEgressPolicy({
    account_id,
    category: opts.category,
  }).catch((err) => {
    if (policyCache.get(key) === value) policyCache.delete(key);
    throw err;
  });
  policyCache.set(key, value);
  return await value;
}

export const __test__ = {
  clearPolicyCache: () => policyCache.clear(),
};
