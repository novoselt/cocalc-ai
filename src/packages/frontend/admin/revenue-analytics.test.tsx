/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";

import type { MembershipAllocationChannel } from "@cocalc/conat/hub/api/purchases";

import { ALL_MEMBERSHIP_CHANNELS } from "./membership-analytics-channels";
import { MembershipChannelSelector } from "./revenue-analytics";

function SelectorHarness() {
  const [channels, setChannels] = useState<MembershipAllocationChannel[]>([
    ...ALL_MEMBERSHIP_CHANNELS,
  ]);
  return <MembershipChannelSelector value={channels} onChange={setChannels} />;
}

describe("revenue analytics membership channel selector", () => {
  it("selects all, none, and an arbitrary subset with accessible checkboxes", () => {
    render(<SelectorHarness />);

    const all = screen.getByRole("checkbox", { name: "All" });
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
});
