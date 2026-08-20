/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import {
  MEMBERSHIP_TRIAL_BANNER_DISMISSED,
  MembershipTrialBanner,
} from "./membership-trial-banner";

const getMembershipTrialOffers = jest.fn();
const openAccountSettings = jest.fn();
const setOtherSettings = jest.fn();

let accountReady = true;
let accountId = "account-1";
let dismissed = false;
let impersonation: unknown = null;
let stripeEnabled = true;

jest.mock("antd", () => ({
  Alert: ({ action, closable, onClose, title }: any) => (
    <div role="alert">
      <div data-testid="alert-title">{title}</div>
      {action}
      {closable ? (
        <button aria-label="Close" type="button" onClick={onClose}>
          Close
        </button>
      ) : null}
    </div>
  ),
  Button: ({ children, onClick }: any) => (
    <button type="button" onClick={onClick}>
      {children}
    </button>
  ),
  Space: ({ children }: any) => <div>{children}</div>,
}));

jest.mock("@cocalc/frontend/account/settings-routing", () => ({
  openAccountSettings: (...args: unknown[]) => openAccountSettings(...args),
}));

jest.mock("@cocalc/frontend/app-framework", () => ({
  useActions: () => ({ set_other_settings: setOtherSettings }),
  useTypedRedux: (store: string, field: string) => {
    if (store === "account" && field === "account_id") return accountId;
    if (store === "account" && field === "is_ready") return accountReady;
    if (store === "account" && field === "is_logged_in") return true;
    if (store === "account" && field === "impersonation") {
      return impersonation;
    }
    if (store === "account" && field === "other_settings") {
      return {
        get: (key: string) =>
          key === MEMBERSHIP_TRIAL_BANNER_DISMISSED && dismissed,
      };
    }
    if (store === "customize" && field === "stripe_enabled") {
      return stripeEnabled;
    }
    return undefined;
  },
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    conat_client: {
      hub: {
        purchases: {
          getMembershipTrialOffers: (...args: unknown[]) =>
            getMembershipTrialOffers(...args),
        },
      },
    },
  },
}));

describe("MembershipTrialBanner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    accountReady = true;
    accountId = "account-1";
    dismissed = false;
    impersonation = null;
    stripeEnabled = true;
  });

  it("advertises eligible tiers and opens membership settings", async () => {
    getMembershipTrialOffers.mockResolvedValue([
      { membership_class: "basic", label: "Basic", trial_days: 7 },
      { membership_class: "standard", label: "Standard", trial_days: 7 },
      { membership_class: "pro", label: "Pro", trial_days: 7 },
    ]);

    render(<MembershipTrialBanner />);

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Claim your free trial for a Basic, Standard, or Pro membership.",
    );
    const viewPlans = within(screen.getByTestId("alert-title")).getByRole(
      "button",
      { name: "View plans" },
    );
    fireEvent.click(viewPlans);
    expect(openAccountSettings).toHaveBeenCalledWith(
      { page: "membership" },
      { openMembershipPlanChooser: true },
    );
  });

  it("persists dismissal for the account", async () => {
    getMembershipTrialOffers.mockResolvedValue([
      { membership_class: "standard", label: "Standard", trial_days: 7 },
    ]);
    render(<MembershipTrialBanner />);

    fireEvent.click(await screen.findByRole("button", { name: "Close" }));

    expect(setOtherSettings).toHaveBeenCalledWith(
      MEMBERSHIP_TRIAL_BANNER_DISMISSED,
      true,
    );
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull());
  });

  it("does not show offers loaded for a different account", async () => {
    getMembershipTrialOffers
      .mockResolvedValueOnce([
        { membership_class: "standard", label: "Standard", trial_days: 7 },
      ])
      .mockReturnValueOnce(new Promise(() => {}));
    const { rerender } = render(<MembershipTrialBanner />);
    expect(await screen.findByRole("alert")).toBeTruthy();

    accountId = "account-2";
    rerender(<MembershipTrialBanner />);

    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("does not load offers after dismissal or while impersonating", () => {
    dismissed = true;
    const { rerender } = render(<MembershipTrialBanner />);
    expect(getMembershipTrialOffers).not.toHaveBeenCalled();

    dismissed = false;
    impersonation = { active: true };
    rerender(<MembershipTrialBanner />);
    expect(getMembershipTrialOffers).not.toHaveBeenCalled();
  });
});
