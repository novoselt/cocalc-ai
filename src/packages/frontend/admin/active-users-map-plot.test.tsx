/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";

import type { ActiveUserMapCountry } from "@cocalc/conat/hub/api/system";
import { ACTIVE_USERS_MAP_ASSET_URL } from "./active-users-map-geometry";
import {
  activeUsersMapCountryPosition,
  ActiveUsersMapPlot,
} from "./active-users-map-plot";

jest.mock("@cocalc/frontend/components", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));

const us: ActiveUserMapCountry = {
  country_code: "US",
  count: 2,
  // Deliberately unrelated to the country label point.
  latitude: 0,
  longitude: 0,
  users: [],
};

describe("ActiveUsersMapPlot", () => {
  it("renders the map when there are no active countries", () => {
    const { container } = render(
      <ActiveUsersMapPlot countries={[]} onSelect={jest.fn()} />,
    );

    expect(
      screen.getByRole("group", { name: "World map of active users" }),
    ).toBeInTheDocument();
    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      ACTIVE_USERS_MAP_ASSET_URL,
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("uses the stable country label point and keeps bubbles interactive", () => {
    const onSelect = jest.fn();
    render(<ActiveUsersMapPlot countries={[us]} onSelect={onSelect} />);

    const button = screen.getByRole("button", {
      name: "United States: 2 active users",
    });
    const position = activeUsersMapCountryPosition(us);
    expect(position.left).not.toBe(50);
    expect(position.top).not.toBe(50);
    expect(button).toHaveStyle({
      left: `${position.left}%`,
      top: `${position.top}%`,
    });

    fireEvent.click(button);
    expect(onSelect).toHaveBeenCalledWith("US");
  });
});
