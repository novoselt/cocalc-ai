/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  MembershipResolution,
  MembershipTrialOffer,
} from "@cocalc/conat/hub/api/purchases";
import { capitalize } from "@cocalc/util/misc";

import { resolveMembershipForAccount } from "./resolve";
import { getSeedMembershipTiers, type MembershipTierRecord } from "./tiers";
import { getMembershipTrialCandidate } from "./trials";

export function selectMembershipTrialOffers({
  membership,
  tiers,
  trialAvailable,
}: {
  membership: MembershipResolution;
  tiers: readonly MembershipTierRecord[];
  trialAvailable: boolean;
}): MembershipTrialOffer[] {
  if (membership.source !== "free" || !trialAvailable) {
    return [];
  }
  return tiers
    .filter(
      (tier) =>
        !tier.disabled &&
        tier.store_visible === true &&
        Number(tier.trial_days ?? 0) > 0 &&
        (Number(tier.price_monthly ?? 0) > 0 ||
          Number(tier.price_yearly ?? 0) > 0),
    )
    .sort(
      (left, right) =>
        Number(left.priority ?? 0) - Number(right.priority ?? 0) ||
        left.id.localeCompare(right.id),
    )
    .map((tier) => ({
      membership_class: tier.id,
      label: `${tier.label ?? ""}`.trim() || capitalize(tier.id),
      trial_days: Math.floor(Number(tier.trial_days)),
    }));
}

export async function getMembershipTrialOffers(
  account_id: string,
): Promise<MembershipTrialOffer[]> {
  const [membership, tiers] = await Promise.all([
    resolveMembershipForAccount(account_id),
    getSeedMembershipTiers({
      includeDisabled: false,
      storeVisibleOnly: true,
    }),
  ]);
  const offers = selectMembershipTrialOffers({
    membership,
    tiers,
    trialAvailable: true,
  });
  if (offers.length === 0) {
    return [];
  }
  const trial = await getMembershipTrialCandidate({
    account_id,
    trial_days: offers[0].trial_days,
  });
  return trial.trial_available ? offers : [];
}
