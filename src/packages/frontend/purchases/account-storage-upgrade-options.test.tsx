/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { fireEvent, render, screen, within } from "@testing-library/react";
import type { MembershipTierLike } from "@cocalc/frontend/account/membership-tiers";
import {
  AccountStorageUpgradeOptions,
  getAccountStorageUpgradeOptions,
} from "./account-storage-upgrade-options";
import type { AccountStorageWarningState } from "./account-storage-warning";

const GB = 1_000_000_000;

const warning: AccountStorageWarningState = {
  used: 4 * GB,
  soft_limit: 3 * GB,
  hard_limit: 4 * GB,
  compare_limit: 4 * GB,
  compare_label: "hard cap",
  ratio: 1,
  percent: 100,
  severity: "blocked",
  over_soft: true,
  over_hard: true,
  partial_measurement: false,
};

const tiers: MembershipTierLike[] = [
  {
    id: "free",
    label: "Free",
    store_visible: true,
    price_monthly: 0,
    price_yearly: 0,
    project_defaults: { disk_quota: 3_000 },
    usage_limits: {
      total_storage_soft_bytes: 3 * GB,
      total_storage_hard_bytes: 4 * GB,
    },
  },
  {
    id: "basic",
    label: "Basic",
    priority: 10,
    store_visible: true,
    price_monthly: 8,
    price_yearly: 72,
    project_defaults: { disk_quota: 8_000 },
    usage_limits: {
      total_storage_soft_bytes: 14 * GB,
      total_storage_hard_bytes: 16 * GB,
    },
  },
  {
    id: "member",
    label: "Standard",
    priority: 20,
    store_visible: true,
    price_monthly: 24,
    price_yearly: 216,
    project_defaults: { disk_quota: 16_000 },
    usage_limits: {
      total_storage_soft_bytes: 45 * GB,
      total_storage_hard_bytes: 50 * GB,
    },
  },
  {
    id: "hidden",
    label: "Hidden",
    store_visible: false,
    price_yearly: 1,
    usage_limits: {
      total_storage_soft_bytes: 100 * GB,
      total_storage_hard_bytes: 100 * GB,
    },
  },
  {
    id: "mixed-limits",
    label: "Mixed limits",
    store_visible: true,
    price_yearly: 1,
    usage_limits: {
      total_storage_soft_bytes: 2 * GB,
      total_storage_hard_bytes: 100 * GB,
    },
  },
];

describe("account storage upgrade options", () => {
  it("includes only purchasable tiers that raise account storage caps", () => {
    expect(getAccountStorageUpgradeOptions(warning, tiers)).toEqual([
      expect.objectContaining({ id: "basic", annual_savings_percent: 25 }),
      expect.objectContaining({ id: "member", annual_savings_percent: 25 }),
    ]);
  });

  it("explains the exact storage headroom and annual discount", () => {
    const onSelect = jest.fn();
    render(
      <AccountStorageUpgradeOptions
        context={warning}
        onSelect={onSelect}
        tiers={tiers}
      />,
    );

    expect(
      screen.getByRole("heading", { name: "How upgrading helps" }),
    ).toBeVisible();
    const basic = screen.getByRole("article", {
      name: "Basic storage upgrade",
    });
    expect(
      within(basic).getByText(/14 GB soft cap \/ 16 GB hard cap/),
    ).toBeVisible();
    expect(
      within(basic).getByText(
        /10 GB before the soft cap; 12 GB before the hard cap/,
      ),
    ).toBeVisible();
    expect(basic).toHaveTextContent("Each project: up to 8 GB");
    expect(basic).toHaveTextContent(
      "$72/year; $6/month equivalent; save 25% versus monthly",
    );

    fireEvent.click(
      within(basic).getByRole("button", { name: "Choose Basic" }),
    );
    expect(onSelect).toHaveBeenCalledWith("basic");
    expect(screen.queryByText("Hidden")).not.toBeInTheDocument();
    expect(screen.queryByText("Mixed limits")).not.toBeInTheDocument();
  });
});
