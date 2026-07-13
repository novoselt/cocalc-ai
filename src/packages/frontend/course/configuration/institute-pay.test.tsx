/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { InstitutePaySection } from "./institute-pay";

jest.mock("@cocalc/frontend/auth/fresh-auth", () => ({
  FreshAuthModal: () => null,
  useFreshAuthAction: () => ({
    runFreshAuthAction: async (action: () => Promise<void>) => await action(),
    freshAuthModalProps: {},
  }),
}));

jest.mock("@cocalc/frontend/components", () => ({
  Icon: ({ name }: { name: string }) => <span>{name}</span>,
  TimeAgo: () => null,
}));

jest.mock("@cocalc/frontend/purchases/api", () => ({
  getMembershipPackageQuote: jest.fn(),
  getMembershipPackages: jest.fn(async () => []),
  isPurchaseAllowed: jest.fn(),
  processPaymentIntents: jest.fn(),
  purchaseMembershipPackage: jest.fn(),
}));

jest.mock("@cocalc/frontend/purchases/payments", () => () => null);
jest.mock("@cocalc/frontend/purchases/stripe-payment", () => () => null);
jest.mock("@cocalc/frontend/purchases/money-statistic", () => () => null);

describe("InstitutePaySection", () => {
  it("offers seat management with the other instructor-paid actions", async () => {
    const onManageSeats = jest.fn();
    render(
      <InstitutePaySection
        project_id="project-1"
        enabled
        showToggle={false}
        selectedTier={{ id: "course-tier" }}
        onManageSeats={onManageSeats}
        onToggle={jest.fn()}
      />,
    );
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    fireEvent.click(screen.getByRole("button", { name: /manage seats/i }));
    expect(onManageSeats).toHaveBeenCalledTimes(1);
  });
});
