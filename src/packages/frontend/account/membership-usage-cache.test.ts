/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const mockGetMembershipDetails = jest.fn();
const mockGetAccountUsageOverview = jest.fn();
const mockGetAIUsage = jest.fn();

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    conat_client: {
      hub: {
        purchases: {
          getMembershipDetails: mockGetMembershipDetails,
          getAccountUsageOverview: mockGetAccountUsageOverview,
          getAIUsage: mockGetAIUsage,
        },
      },
    },
  },
}));

import {
  getWarningAccountUsageOverview,
  getWarningAIUsage,
  getWarningMembershipDetails,
} from "./membership-usage-cache";

describe("membership usage warning cache", () => {
  it("shares requests and cached values only within one account", async () => {
    mockGetMembershipDetails
      .mockResolvedValueOnce({ selected: { tier: "member-a" } })
      .mockResolvedValueOnce({ selected: { tier: "member-b" } });

    const [firstA, secondA] = await Promise.all([
      getWarningMembershipDetails("account-a"),
      getWarningMembershipDetails("account-a"),
    ]);
    const firstB = await getWarningMembershipDetails("account-b");

    expect(firstA).toEqual({ selected: { tier: "member-a" } });
    expect(secondA).toBe(firstA);
    expect(firstB).toEqual({ selected: { tier: "member-b" } });
    expect(mockGetMembershipDetails).toHaveBeenCalledTimes(2);
  });

  it("keys account and AI usage caches by account", async () => {
    mockGetAccountUsageOverview
      .mockResolvedValueOnce({ meters: [{ id: "account-a" }] })
      .mockResolvedValueOnce({ meters: [{ id: "account-b" }] });
    mockGetAIUsage
      .mockResolvedValueOnce({ windows: [{ window: "5h", used: 1 }] })
      .mockResolvedValueOnce({ windows: [{ window: "5h", used: 2 }] });

    expect(await getWarningAccountUsageOverview("account-a")).toEqual({
      meters: [{ id: "account-a" }],
    });
    expect(await getWarningAccountUsageOverview("account-b")).toEqual({
      meters: [{ id: "account-b" }],
    });
    expect(await getWarningAIUsage("account-a")).toEqual({
      windows: [{ window: "5h", used: 1 }],
    });
    expect(await getWarningAIUsage("account-b")).toEqual({
      windows: [{ window: "5h", used: 2 }],
    });
    expect(mockGetAccountUsageOverview).toHaveBeenCalledTimes(2);
    expect(mockGetAIUsage).toHaveBeenCalledTimes(2);
  });
});
