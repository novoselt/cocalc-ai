/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  defaultHostFundingMode,
  getHostFundingModeOptions,
  hostFundingModeLabel,
  isBillableHostProvider,
} from "./funding-mode";

describe("host funding mode helpers", () => {
  it("offers only prepaid to non-admin accounts without postpaid limits", () => {
    expect(
      getHostFundingModeOptions({
        isAdmin: false,
        membership: {
          class: "member",
          source: "subscription",
          entitlements: {},
          effective_limits: {
            prepaid_host_usage_limit_5h_usd: 300,
          },
        },
      }),
    ).toEqual([
      {
        value: "account-prepaid",
        label: "Prepaid from this account",
      },
    ]);
  });

  it("offers all three funding modes to admins", () => {
    expect(
      getHostFundingModeOptions({
        isAdmin: true,
        membership: null,
      }),
    ).toEqual([
      {
        value: "site-funded",
        label: "Site-funded",
      },
      {
        value: "account-prepaid",
        label: "Prepaid from this account",
      },
      {
        value: "account-postpaid",
        label: "Postpaid to this account",
      },
    ]);
  });

  it("prefers prepaid over postpaid by default", () => {
    expect(
      defaultHostFundingMode({
        options: [
          { value: "account-prepaid", label: "Prepaid from this account" },
          { value: "account-postpaid", label: "Postpaid to this account" },
        ],
      }),
    ).toBe("account-prepaid");
  });

  it("detects billable providers", () => {
    expect(isBillableHostProvider("gcp")).toBe(true);
    expect(isBillableHostProvider("self-host")).toBe(false);
    expect(isBillableHostProvider("none")).toBe(false);
  });

  it("formats funding modes for operator-facing summaries", () => {
    expect(hostFundingModeLabel("site-funded")).toBe("Site-funded");
    expect(hostFundingModeLabel("account-prepaid")).toBe("Account prepaid");
    expect(hostFundingModeLabel("account-postpaid")).toBe("Account postpaid");
    expect(hostFundingModeLabel()).toBe("Funding unknown");
  });
});
