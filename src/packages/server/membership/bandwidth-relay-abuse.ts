/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import type { ProjectBandwidthRelayEvidence } from "@cocalc/conat/hub/api/system";
import { getServerSettings } from "@cocalc/database/settings/server-settings";
import {
  banClusterAccountAndEquivalentEmails,
  getClusterAccountById,
} from "@cocalc/server/inter-bay/accounts";
import { getManagedEgressCategoryUsageForAccount } from "./managed-egress";
import {
  getProjectOwnerAccountId,
  getProjectUserAccountIds,
} from "./project-usage";
import { resolveMembershipForAccount } from "./resolve";

const logger = getLogger("server:membership:bandwidth-relay-abuse");
const DEFAULT_NEW_ACCOUNT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const DEFAULT_RAW_NETWORK_5H_THRESHOLD_BYTES = 1024 ** 3;
const DEFAULT_RAW_NETWORK_7D_THRESHOLD_BYTES = 3 * 1024 ** 3;

export interface ProjectBandwidthRelayAbuseSettings {
  enforcement_enabled: boolean;
  auto_ban_enabled: boolean;
}

export interface ProjectBandwidthRelayAbuseDecision {
  should_stop_project: boolean;
  auto_banned: boolean;
  abuse_kind?: "bandwidth_relay";
  membership_class?: string;
  membership_source?: string;
  account_age_ms?: number;
  raw_network_bytes_5h?: number;
  raw_network_bytes_7d?: number;
  account_owns_project?: boolean;
  account_is_sole_project_user?: boolean;
  ban_error?: string;
}

function positiveIntEnv(name: string, fallback: number): number {
  const raw = `${process.env[name] ?? ""}`.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function settingEnabled(value: unknown): boolean {
  return value === true || value === "yes" || value === "true";
}

function createdTimeMs(created: unknown): number | undefined {
  if (created instanceof Date) return created.getTime();
  if (typeof created === "number" && Number.isFinite(created)) return created;
  if (typeof created === "string") {
    const value = Date.parse(created);
    return Number.isFinite(value) ? value : undefined;
  }
}

export async function getProjectBandwidthRelayAbuseSettings(): Promise<ProjectBandwidthRelayAbuseSettings> {
  const settings = await getServerSettings();
  return {
    enforcement_enabled: settingEnabled(
      settings.bandwidth_relay_abuse_enforcement_enabled,
    ),
    auto_ban_enabled: settingEnabled(
      settings.bandwidth_relay_abuse_auto_ban_enabled,
    ),
  };
}

export function sanitizeBandwidthRelayEvidenceMetadata({
  metadata,
  enforcement_enabled,
}: {
  metadata?: Record<string, unknown>;
  enforcement_enabled: boolean;
}): Record<string, unknown> | undefined {
  if (
    enforcement_enabled ||
    !metadata ||
    !("bandwidth_relay_evidence" in metadata)
  ) {
    return metadata;
  }
  return Object.fromEntries(
    Object.entries(metadata).filter(
      ([key]) => key !== "bandwidth_relay_evidence",
    ),
  );
}

export function isHighConfidenceBandwidthRelayEvidence(
  evidence: ProjectBandwidthRelayEvidence | undefined,
): evidence is ProjectBandwidthRelayEvidence {
  if (evidence?.confidence !== "high") return false;
  const signals = evidence.signals ?? [];
  return (
    signals.some((signal) => signal.kind === "tunnel_process") &&
    signals.some(
      (signal) =>
        signal.kind === "bulk_transfer_process" ||
        signal.kind === "automated_uploader_process",
    )
  );
}

export function isAutoBanEligibleBandwidthRelayEvidence(
  evidence: ProjectBandwidthRelayEvidence | undefined,
): evidence is ProjectBandwidthRelayEvidence {
  return (
    isHighConfidenceBandwidthRelayEvidence(evidence) &&
    evidence.signals.some(
      (signal) => signal.kind === "automated_uploader_process",
    )
  );
}

export async function handleProjectBandwidthRelayEvidence({
  account_id,
  project_id,
  evidence,
  now = new Date(),
  settings,
}: {
  account_id: string;
  project_id: string;
  evidence?: ProjectBandwidthRelayEvidence;
  now?: Date;
  settings?: ProjectBandwidthRelayAbuseSettings;
}): Promise<ProjectBandwidthRelayAbuseDecision> {
  if (!isHighConfidenceBandwidthRelayEvidence(evidence)) {
    return { should_stop_project: false, auto_banned: false };
  }
  const resolvedSettings =
    settings ?? (await getProjectBandwidthRelayAbuseSettings());
  if (!resolvedSettings.enforcement_enabled) {
    return { should_stop_project: false, auto_banned: false };
  }

  const usage = await getManagedEgressCategoryUsageForAccount({
    account_id,
    category: "raw-network",
    now,
  });
  const threshold5h = positiveIntEnv(
    "COCALC_BANDWIDTH_RELAY_ABUSE_RAW_NETWORK_5H_BYTES",
    DEFAULT_RAW_NETWORK_5H_THRESHOLD_BYTES,
  );
  const threshold7d = positiveIntEnv(
    "COCALC_BANDWIDTH_RELAY_ABUSE_RAW_NETWORK_7D_BYTES",
    DEFAULT_RAW_NETWORK_7D_THRESHOLD_BYTES,
  );
  if (usage.bytes_5h < threshold5h && usage.bytes_7d < threshold7d) {
    return {
      should_stop_project: false,
      auto_banned: false,
      raw_network_bytes_5h: usage.bytes_5h,
      raw_network_bytes_7d: usage.bytes_7d,
    };
  }

  const [account, membership, ownerAccountId, projectUserAccountIds] =
    await Promise.all([
      getClusterAccountById(account_id),
      resolveMembershipForAccount(account_id),
      getProjectOwnerAccountId(project_id),
      getProjectUserAccountIds(project_id),
    ]);
  const createdMs = createdTimeMs(account?.created);
  const accountAgeMs =
    createdMs == null ? undefined : Math.max(0, now.getTime() - createdMs);
  const isNew =
    accountAgeMs != null &&
    accountAgeMs <=
      positiveIntEnv(
        "COCALC_BANDWIDTH_RELAY_AUTO_BAN_ACCOUNT_MAX_AGE_MS",
        DEFAULT_NEW_ACCOUNT_MAX_AGE_MS,
      );
  const isFree = membership.class === "free" && membership.source === "free";
  const accountOwnsProject = ownerAccountId === account_id;
  const accountIsSoleProjectUser =
    projectUserAccountIds.length === 1 &&
    projectUserAccountIds[0] === account_id;
  const shouldAutoBan =
    resolvedSettings.auto_ban_enabled &&
    !account?.banned &&
    isFree &&
    isNew &&
    accountOwnsProject &&
    accountIsSoleProjectUser &&
    isAutoBanEligibleBandwidthRelayEvidence(evidence);

  const decision = {
    should_stop_project: true,
    auto_banned: false,
    abuse_kind: "bandwidth_relay" as const,
    membership_class: membership.class,
    membership_source: membership.source,
    account_age_ms: accountAgeMs,
    raw_network_bytes_5h: usage.bytes_5h,
    raw_network_bytes_7d: usage.bytes_7d,
    account_owns_project: accountOwnsProject,
    account_is_sole_project_user: accountIsSoleProjectUser,
  };

  if (!shouldAutoBan) {
    logger.warn("high-confidence bandwidth relay detected; stopping project", {
      account_id,
      project_id,
      membership_class: membership.class,
      membership_source: membership.source,
      account_age_ms: accountAgeMs,
      account_owns_project: accountOwnsProject,
      account_is_sole_project_user: accountIsSoleProjectUser,
      raw_network_bytes_5h: usage.bytes_5h,
      raw_network_bytes_7d: usage.bytes_7d,
      signal_count: evidence.signals.length,
      auto_banned: false,
    });
    return decision;
  }

  try {
    await banClusterAccountAndEquivalentEmails({
      account_id,
      actor_account_id: null,
      reason: "automatic high-confidence bandwidth relay detection",
      metadata: {
        automatic: true,
        detector: "bandwidth-relay-policy-v2",
        abuse_kind: "bandwidth_relay",
        project_id,
        evidence,
        membership_class: membership.class,
        membership_source: membership.source,
        account_age_ms: accountAgeMs ?? null,
        raw_network_bytes_5h: usage.bytes_5h,
        raw_network_bytes_7d: usage.bytes_7d,
        account_is_sole_project_user: accountIsSoleProjectUser,
      },
    });
    logger.warn(
      "auto-banned new free account for high-confidence bandwidth relay",
      {
        account_id,
        project_id,
        account_age_ms: accountAgeMs,
        raw_network_bytes_5h: usage.bytes_5h,
        raw_network_bytes_7d: usage.bytes_7d,
        signal_count: evidence.signals.length,
      },
    );
    return { ...decision, auto_banned: true };
  } catch (err) {
    logger.warn("failed to auto-ban account for bandwidth relay abuse", {
      account_id,
      project_id,
      err: `${err}`,
    });
    return { ...decision, ban_error: `${err}` };
  }
}

export const __test__ = {
  createdTimeMs,
  DEFAULT_NEW_ACCOUNT_MAX_AGE_MS,
  DEFAULT_RAW_NETWORK_5H_THRESHOLD_BYTES,
  DEFAULT_RAW_NETWORK_7D_THRESHOLD_BYTES,
};
