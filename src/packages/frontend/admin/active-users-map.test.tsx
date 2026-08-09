import { fireEvent, render, screen } from "@testing-library/react";

import { ActiveUsersMapSummary } from "./active-users-map-summary";

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
