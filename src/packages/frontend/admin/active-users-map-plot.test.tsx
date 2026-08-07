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
  transformActiveUsersMapPosition,
} from "./active-users-map-plot";
import { useActiveUsersMapZoom } from "./active-users-map-zoom";

jest.mock("@cocalc/frontend/components", () => ({
  Icon: ({ name }: { name: string }) => <span data-icon={name} />,
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("./active-users-map-zoom", () => ({
  ACTIVE_USERS_MAP_MAX_ZOOM: 8,
  ACTIVE_USERS_MAP_MIN_ZOOM: 1,
  useActiveUsersMapZoom: jest.fn(),
}));

const mockReset = jest.fn();
const mockZoomBy = jest.fn();
const mockUseActiveUsersMapZoom = jest.mocked(useActiveUsersMapZoom);

const us: ActiveUserMapCountry = {
  country_code: "US",
  count: 2,
  // Deliberately unrelated to the country label point.
  latitude: 0,
  longitude: 0,
  users: [],
};

describe("ActiveUsersMapPlot", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseActiveUsersMapZoom.mockReturnValue({
      reset: mockReset,
      transform: { k: 1, x: 0, y: 0 },
      viewportRef: { current: null },
      zoomBy: mockZoomBy,
    });
  });

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
    expect(screen.getByRole("button", { name: "Zoom in" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
    expect(screen.getByText("Scroll to zoom · Drag to pan")).toBeVisible();
    expect(
      screen.queryByRole("button", { name: /active users?$/ }),
    ).not.toBeInTheDocument();
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

  it("moves bubble positions without scaling their controls", () => {
    expect(
      transformActiveUsersMapPosition(
        { left: 25, top: 40 },
        { k: 2, x: -100, y: 50 },
      ),
    ).toEqual({
      left: "calc(50% - 100px)",
      top: "calc(80% + 50px)",
    });
  });

  it("connects the visible zoom and reset controls", () => {
    const { unmount } = render(
      <ActiveUsersMapPlot countries={[us]} onSelect={jest.fn()} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(mockZoomBy).toHaveBeenCalledWith(2);
    unmount();

    mockUseActiveUsersMapZoom.mockReturnValue({
      reset: mockReset,
      transform: { k: 2, x: -100, y: -50 },
      viewportRef: { current: null },
      zoomBy: mockZoomBy,
    });
    render(<ActiveUsersMapPlot countries={[us]} onSelect={jest.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: /Reset/ }));
    expect(mockReset).toHaveBeenCalled();
  });
});
