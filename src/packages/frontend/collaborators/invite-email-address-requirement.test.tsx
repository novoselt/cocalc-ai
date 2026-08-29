/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { IntlProvider } from "react-intl";
import { InviteEmailAddressRequirement } from "./invite-email-address-requirement";

describe("InviteEmailAddressRequirement", () => {
  it("exposes a labeled checkbox and reports policy changes", () => {
    const onChange = jest.fn();
    render(
      <IntlProvider locale="en">
        <InviteEmailAddressRequirement checked={false} onChange={onChange} />
      </IntlProvider>,
    );

    const checkbox = screen.getByRole("checkbox", {
      name: /require acceptance using the invited email address/i,
    });
    expect(checkbox).not.toBeChecked();

    fireEvent.click(checkbox);
    expect(onChange).toHaveBeenCalledWith(true);
  });
});
