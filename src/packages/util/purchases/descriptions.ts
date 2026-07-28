/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  TEAM_LICENSE_CHANGE,
  TEAM_LICENSE_RENEWAL,
} from "@cocalc/util/db-schema/purchases";

export type MembershipTierLabels = Record<string, string>;

export function membershipTierLabel(
  membershipClass: unknown,
  labels: MembershipTierLabels,
): string {
  const id = typeof membershipClass === "string" ? membershipClass : "";
  return id ? (labels[id] ?? id) : "unknown";
}

function membershipIntervalLabel(interval: unknown): string {
  if (interval === "month") {
    return "monthly";
  }
  if (interval === "year") {
    return "annual";
  }
  return `${interval ?? "unknown"}`;
}

function formatMembershipPurchaseDescription({
  interval,
  membershipLabel,
}: {
  interval: unknown;
  membershipLabel: string;
}): string {
  return `${membershipLabel} membership, ${membershipIntervalLabel(interval)}`;
}

export function formatMembershipCreditPurchaseDescription({
  interval,
  membershipLabel,
}: {
  interval: unknown;
  membershipLabel: string;
}): string {
  return formatMembershipPurchaseDescription({ interval, membershipLabel });
}

export function formatMembershipDebitPurchaseDescription({
  description,
  labels,
}: {
  description:
    | {
        class?: unknown;
        interval?: unknown;
        membership_class?: unknown;
      }
    | null
    | undefined;
  labels: MembershipTierLabels;
}): string {
  return formatMembershipPurchaseDescription({
    interval: description?.interval,
    membershipLabel: membershipTierLabel(
      description?.class ?? description?.membership_class,
      labels,
    ),
  });
}

export function formatTeamLicenseCreditPurchaseDescription(
  type: unknown,
): string {
  switch (type) {
    case TEAM_LICENSE_CHANGE:
      return "Team license";
    case TEAM_LICENSE_RENEWAL:
      return "Team license renewal";
    default:
      return "";
  }
}

export function formatTeamLicenseDebitPurchaseDescription(description: {
  type?: unknown;
}): string {
  return formatTeamLicenseCreditPurchaseDescription(description?.type);
}
