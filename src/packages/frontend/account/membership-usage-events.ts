/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  AccountUsageOverview,
  MembershipDetails,
} from "@cocalc/conat/hub/api/purchases";

type AccountScopedCustomEvent<T> = CustomEvent<T> & {
  account_id?: string;
};

export const MEMBERSHIP_DETAILS_REFRESHED_EVENT =
  "cocalc:membership-details-refreshed";
export const ACCOUNT_USAGE_OVERVIEW_REFRESHED_EVENT =
  "cocalc:account-usage-overview-refreshed";

export function dispatchMembershipDetailsRefreshed(
  details: MembershipDetails,
  account_id?: string,
): void {
  if (typeof window === "undefined") return;
  const event = new CustomEvent<MembershipDetails>(
    MEMBERSHIP_DETAILS_REFRESHED_EVENT,
    { detail: details },
  ) as AccountScopedCustomEvent<MembershipDetails>;
  event.account_id = account_id;
  window.dispatchEvent(event);
}

export function getMembershipDetailsRefreshedEventDetail(
  event: Event,
  account_id?: string,
): MembershipDetails | undefined {
  const scoped = event as AccountScopedCustomEvent<MembershipDetails>;
  if (account_id && scoped.account_id && scoped.account_id !== account_id) {
    return;
  }
  return scoped.detail;
}

export function dispatchAccountUsageOverviewRefreshed(
  overview: AccountUsageOverview,
  account_id?: string,
): void {
  if (typeof window === "undefined") return;
  const event = new CustomEvent<AccountUsageOverview>(
    ACCOUNT_USAGE_OVERVIEW_REFRESHED_EVENT,
    { detail: overview },
  ) as AccountScopedCustomEvent<AccountUsageOverview>;
  event.account_id = account_id;
  window.dispatchEvent(event);
}

export function getAccountUsageOverviewRefreshedEventDetail(
  event: Event,
  account_id?: string,
): AccountUsageOverview | undefined {
  const scoped = event as AccountScopedCustomEvent<AccountUsageOverview>;
  if (account_id && scoped.account_id && scoped.account_id !== account_id) {
    return;
  }
  return scoped.detail;
}
