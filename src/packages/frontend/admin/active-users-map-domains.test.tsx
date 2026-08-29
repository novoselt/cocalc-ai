import { render, screen } from "@testing-library/react";

import type { ActiveUserMapUser } from "@cocalc/conat/hub/api/system";

import {
  activeUserEmailDomainCounts,
  ActiveUsersMapDomainChart,
} from "./active-users-map-domains";

let plotProps: any;

jest.mock("@cocalc/frontend/components/plotly", () => ({
  __esModule: true,
  default: (props: any) => {
    plotProps = props;
    return <div data-testid="domain-plot" />;
  },
}));

function user(account_id: string, email_address?: string): ActiveUserMapUser {
  return {
    account_id,
    email_address,
    bay_id: "bay-1",
    last_active: "2026-08-27T00:00:00.000Z",
  };
}

beforeEach(() => {
  plotProps = undefined;
});

describe("activeUserEmailDomainCounts", () => {
  it("normalizes domains and accounts for missing email addresses", () => {
    expect(
      activeUserEmailDomainCounts([
        user("1", " Ada@Example.COM "),
        user("2", "grace@example.com"),
        user("3"),
        user("4", "invalid"),
      ]),
    ).toEqual([
      { domain: "example.com", count: 2 },
      { domain: "Unknown", count: 2 },
    ]);
  });

  it("combines domains below 1.5 percent and keeps the boundary", () => {
    const users = [
      ...Array.from({ length: 193 }, (_, index) =>
        user(`major-${index}`, `user-${index}@major.test`),
      ),
      user("exact-1", "one@exact.test"),
      user("exact-2", "two@exact.test"),
      user("exact-3", "three@exact.test"),
      user("small-1", "user@small-1.test"),
      user("small-2", "user@small-2.test"),
      user("small-3", "user@small-3.test"),
      user("small-4", "user@small-4.test"),
    ];

    const counts = activeUserEmailDomainCounts(users);

    expect(counts).toEqual([
      { domain: "major.test", count: 193 },
      { domain: "exact.test", count: 3 },
      { domain: "Other", count: 4 },
    ]);
  });
});

describe("ActiveUsersMapDomainChart", () => {
  it("renders live domain counts with accessible chart details", () => {
    render(
      <ActiveUsersMapDomainChart
        users={[
          user("1", "ada@example.com"),
          user("2", "grace@example.com"),
          user("3", "linus@kernel.org"),
        ]}
      />,
    );

    expect(
      screen.getByRole("img", {
        name: "Email domains for 3 active users: example.com, 2; kernel.org, 1.",
      }),
    ).toBeVisible();
    expect(screen.getByTestId("domain-plot")).toBeInTheDocument();
    expect(plotProps.data).toHaveLength(2);
    expect(plotProps.data[0]).toMatchObject({
      labels: ["example.com", "kernel.org"],
      values: [2, 1],
      direction: "clockwise",
      rotation: 135,
      texttemplate: "%{label}",
      textposition: "outside",
    });
    expect(plotProps.data[1]).toMatchObject({
      labels: ["example.com", "kernel.org"],
      values: [2, 1],
      direction: "clockwise",
      rotation: 135,
      texttemplate: "%{value:d}",
      textposition: "inside",
    });
    expect(plotProps.layout.height).toBe(520);
    expect(plotProps.layout.margin).toBeUndefined();
  });
});
