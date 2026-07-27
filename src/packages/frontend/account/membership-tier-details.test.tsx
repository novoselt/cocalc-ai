/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { render, screen } from "@testing-library/react";

import {
  MembershipTierComparison,
  MembershipTierDetails,
  SHARED_SERVICE_PARAMETERS_NOTICE,
} from "./membership-tier-details";

const free = {
  id: "free",
  label: "Free",
  ai_limits: { units_5h: 10, units_7d: 50 },
  features: { create_hosts: false, project_host_tier: 0 },
  price_monthly: 0,
  price_yearly: 0,
  project_defaults: { disk_quota: 1_000, memory: 2_000 },
  usage_limits: {
    cpu_5h_seconds: 3_600,
    egress_5h_bytes: 1_000_000_000,
  },
};

const member = {
  id: "member",
  label: "Member",
  ai_limits: { units_5h: 100, units_7d: 500 },
  features: { create_hosts: true, project_host_tier: 1 },
  price_monthly: 25,
  price_yearly: 225,
  project_defaults: { disk_quota: 10_000, memory: 8_000 },
  usage_limits: {
    cpu_5h_seconds: 18_000,
    egress_5h_bytes: 12_000_000_000,
    project_max_collaborators_and_pending_invites: 50,
  },
};

describe("membership tier details", () => {
  it("shows exact configured values and the shared-service notice", () => {
    render(<MembershipTierDetails tier={member} />);

    expect(screen.getByText(SHARED_SERVICE_PARAMETERS_NOTICE)).toBeTruthy();
    expect(screen.getByText("Compute and projects")).toBeTruthy();
    expect(screen.getByText("Managed CPU, rolling 5 hours")).toBeTruthy();
    expect(screen.getByText("5 CPU-hours")).toBeTruthy();
    expect(
      screen.getByText("Managed network transfer, rolling 5 hours"),
    ).toBeTruthy();
    expect(screen.getByText("12 GB")).toBeTruthy();
    expect(
      screen.getByText("Project collaborators and pending invitations"),
    ).toBeTruthy();
    expect(screen.getByText("Rent dedicated project hosts")).toBeTruthy();
  });

  it("compares every configured category and marks the current tier", () => {
    render(
      <MembershipTierComparison
        currentTierId="member"
        tiers={[free, member]}
      />,
    );

    expect(
      screen.getByRole("table", { name: "Membership comparison" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Compare Memberships" }),
    ).toBeTruthy();
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.getByText("AI and Codex automation")).toBeTruthy();
    expect(screen.getAllByText("1 CPU-hour").length).toBeGreaterThan(0);
    expect(screen.getAllByText("5 CPU-hours").length).toBeGreaterThan(0);
    expect(screen.getAllByText("No").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Yes").length).toBeGreaterThan(0);
  });
});
