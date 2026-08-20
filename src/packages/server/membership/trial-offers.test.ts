/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { MembershipResolution } from "@cocalc/conat/hub/api/purchases";

import { selectMembershipTrialOffers } from "./trial-offers";

const freeMembership: MembershipResolution = {
  class: "free",
  source: "free",
  entitlements: {},
};

describe("selectMembershipTrialOffers", () => {
  const tiers = [
    {
      id: "pro",
      label: "Pro",
      priority: 30,
      price_yearly: 1200,
      store_visible: true,
      trial_days: 7,
    },
    {
      id: "standard",
      label: "Standard",
      priority: 20,
      price_monthly: 18,
      store_visible: true,
      trial_days: 7,
    },
    {
      id: "basic",
      priority: 10,
      price_monthly: 8,
      store_visible: true,
      trial_days: 0,
    },
    {
      id: "private",
      priority: 40,
      price_monthly: 300,
      store_visible: false,
      trial_days: 14,
    },
  ];

  it("returns purchasable trial tiers in membership priority order", () => {
    expect(
      selectMembershipTrialOffers({
        membership: freeMembership,
        tiers,
        trialAvailable: true,
      }),
    ).toEqual([
      {
        membership_class: "standard",
        label: "Standard",
        trial_days: 7,
      },
      { membership_class: "pro", label: "Pro", trial_days: 7 },
    ]);
  });

  it("does not advertise trials to paid or ineligible accounts", () => {
    const paidMembership: MembershipResolution = {
      ...freeMembership,
      class: "standard",
      source: "subscription",
    };
    expect(
      selectMembershipTrialOffers({
        membership: paidMembership,
        tiers,
        trialAvailable: true,
      }),
    ).toEqual([]);
    expect(
      selectMembershipTrialOffers({
        membership: freeMembership,
        tiers,
        trialAvailable: false,
      }),
    ).toEqual([]);
  });
});
