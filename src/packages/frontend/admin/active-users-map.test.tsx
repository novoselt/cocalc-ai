import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  ActiveUsersMapAdmin,
  activeUsersMapDrawerTitle,
} from "./active-users-map";
import { ActiveUsersMapSummary } from "./active-users-map-summary";

const mockGetActiveUserMap = jest.fn();
const mockGetHistorySeries = jest.fn();

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    conat_client: {
      hub: {
        system: {
          getActiveUserMap: (...args: unknown[]) =>
            mockGetActiveUserMap(...args),
          getActiveUserMapHistorySeries: (...args: unknown[]) =>
            mockGetHistorySeries(...args),
          getActiveUserMapHistorySnapshot: jest.fn(async () => null),
        },
      },
    },
  },
}));
jest.mock("./active-users-map-plot", () => ({
  activeUsersMapLocationName: () => "Location",
  ActiveUsersMapPlot: () => <div>Map</div>,
}));
jest.mock("./active-users-map-history-plot", () => ({
  ActiveUsersMapHistoryPlot: () => <div>History plot</div>,
}));
jest.mock("./users/user", () => ({ UserResult: () => null }));
jest.mock("@cocalc/frontend/frame-editors/generic/client", () => ({
  user_search: jest.fn(async () => []),
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockGetActiveUserMap.mockResolvedValue({
    enabled: true,
    checked_at: "2026-08-27T00:00:00.000Z",
    bay_id: "bay-1",
    current_bay_id: "bay-1",
    active_minutes: 15,
    total_active: 0,
    mapped_active: 0,
    unknown_location: 0,
    countries: [],
    unknown_users: [],
    bays: [{ bay_id: "bay-1", ok: true, enabled: true, total_active: 0 }],
  });
  mockGetHistorySeries.mockResolvedValue({
    active_minutes: 60,
    days: 365,
    country_code: null,
    country_codes: [],
    points: [],
  });
});

describe("ActiveUsersMapSummary", () => {
  it("shows compact counts and opens unavailable locations", () => {
    const onShowUnavailable = jest.fn();
    render(
      <ActiveUsersMapSummary
        total={793}
        mapped={435}
        unavailable={358}
        onShowUnavailable={onShowUnavailable}
        hint="Select a country to view its active users."
      />,
    );

    expect(screen.getByText("Active users:")).toHaveTextContent("793");
    expect(screen.getByText("On map:")).toHaveTextContent("435");
    expect(
      screen.getByText("Select a country to view its active users."),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: "Location unavailable: 358" }),
    );
    expect(onShowUnavailable).toHaveBeenCalledTimes(1);
  });

  it("does not offer unavailable-location details when there are none", () => {
    render(
      <ActiveUsersMapSummary
        total={42}
        mapped={42}
        unavailable={0}
        onShowUnavailable={jest.fn()}
        hint="Select a country to view its active users."
      />,
    );

    expect(
      screen.queryByRole("button", { name: /Location unavailable/ }),
    ).not.toBeInTheDocument();
    expect(screen.getByText("Location unavailable:")).toHaveTextContent("0");
  });
});

describe("ActiveUsersMapAdmin", () => {
  it("requests optional city groups from the last live-mode control", async () => {
    render(<ActiveUsersMapAdmin />);

    const checkbox = screen.getByRole("checkbox", { name: "Group by city" });
    await waitFor(() =>
      expect(mockGetActiveUserMap).toHaveBeenCalledWith({
        active_minutes: 15,
        group_by: "country",
      }),
    );

    fireEvent.click(checkbox);
    await waitFor(() =>
      expect(mockGetActiveUserMap).toHaveBeenLastCalledWith({
        active_minutes: 15,
        group_by: "city",
      }),
    );

    fireEvent.click(screen.getByRole("radio", { name: "History" }));
    expect(
      screen.queryByRole("checkbox", { name: "Group by city" }),
    ).not.toBeInTheDocument();
  });
});

describe("activeUsersMapDrawerTitle", () => {
  it("describes named and unavailable locations with user counts", () => {
    expect(activeUsersMapDrawerTitle("Canada", 34)).toBe(
      "Canada: 34 active users",
    );
    expect(activeUsersMapDrawerTitle("Location unavailable", 1)).toBe(
      "Location unavailable: 1 active user",
    );
  });
});
