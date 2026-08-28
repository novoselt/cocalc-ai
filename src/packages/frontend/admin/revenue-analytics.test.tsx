/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import type {
  ComputeRevenueProduct,
  MembershipAllocationChannel,
} from "@cocalc/conat/hub/api/purchases";

import { ALL_MEMBERSHIP_CHANNELS } from "./membership-analytics-channels";
import {
  ALL_COMPUTE_PRODUCTS,
  ComputeProductSelector,
  DEFAULT_COMPUTE_PRODUCTS,
  MembershipChannelSelector,
} from "./revenue-analytics";

function SelectorHarness() {
  const [channels, setChannels] = useState<MembershipAllocationChannel[]>([
    ...ALL_MEMBERSHIP_CHANNELS,
  ]);
  return <MembershipChannelSelector value={channels} onChange={setChannels} />;
}

function ComputeSelectorHarness() {
  const [products, setProducts] = useState<ComputeRevenueProduct[]>([]);
  return <ComputeProductSelector value={products} onChange={setProducts} />;
}

describe("revenue analytics membership channel selector", () => {
  it("shows all revenue sources by default", () => {
    expect(DEFAULT_COMPUTE_PRODUCTS).toEqual(ALL_COMPUTE_PRODUCTS);
  });

  it("selects all, none, and an arbitrary subset with accessible checkboxes", () => {
    render(<SelectorHarness />);

    const all = screen.getByRole("checkbox", {
      name: "All membership channels",
    });
    const personal = screen.getByRole("checkbox", { name: "Personal" });
    const student = screen.getByRole("checkbox", {
      name: "Student-pay",
    });

    expect(all).toBeChecked();
    expect(personal).toBeChecked();
    expect(student).toBeChecked();

    fireEvent.click(all);
    expect(all).not.toBeChecked();
    expect(personal).not.toBeChecked();
    expect(student).not.toBeChecked();

    personal.focus();
    expect(personal).toHaveFocus();
    fireEvent.click(personal);
    expect(personal).toBeChecked();
    expect(all).toBePartiallyChecked();

    fireEvent.click(all);
    expect(all).toBeChecked();
    expect(personal).toBeChecked();
    expect(student).toBeChecked();
  });

  it("selects compute products independently with accessible checkboxes", () => {
    render(<ComputeSelectorHarness />);
    const all = screen.getByRole("checkbox", { name: "All compute products" });
    const hosts = screen.getByRole("checkbox", { name: "Dedicated hosts" });
    const vms = screen.getByRole("checkbox", { name: "Virtual machines" });
    expect(all).not.toBeChecked();
    fireEvent.click(hosts);
    expect(hosts).toBeChecked();
    expect(all).toBePartiallyChecked();
    fireEvent.click(all);
    expect(all).toBeChecked();
    expect(vms).toBeChecked();
    expect(ALL_COMPUTE_PRODUCTS).toHaveLength(2);
  });
});
