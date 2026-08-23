/** @jest-environment jsdom */

import { fireEvent, render, screen } from "@testing-library/react";

import { NavbarMembershipSetting } from "./navbar-membership-setting";

const setOtherSettings = jest.fn();
let hidden = false;

jest.mock("@cocalc/frontend/app-framework", () => ({
  useAccountOtherSetting: () => hidden,
  useActions: () => ({ set_other_settings: setOtherSettings }),
}));

jest.mock("@cocalc/frontend/antd-bootstrap", () => ({
  Switch: ({ checked, children, onChange }: any) => (
    <label>
      <input
        checked={checked}
        onChange={(event) =>
          onChange({ target: { checked: event.currentTarget.checked } })
        }
        type="checkbox"
      />
      {children}
    </label>
  ),
}));

jest.mock("react-intl", () => ({
  FormattedMessage: ({ defaultMessage }: { defaultMessage: string }) => (
    <span>{defaultMessage.replace(/<\/?strong>/g, "")}</span>
  ),
}));

describe("NavbarMembershipSetting", () => {
  beforeEach(() => {
    hidden = false;
    setOtherSettings.mockReset();
  });

  it("persists whether the membership tier is hidden", () => {
    render(<NavbarMembershipSetting />);

    const toggle = screen.getByRole("checkbox", {
      name: "Hide Membership Tier in navigation bar",
    });
    expect(toggle).not.toBeChecked();

    fireEvent.click(toggle);

    expect(setOtherSettings).toHaveBeenCalledWith(
      "hide_navbar_membership",
      true,
    );
  });
});
