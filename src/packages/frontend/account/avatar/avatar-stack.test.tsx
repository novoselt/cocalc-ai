/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { Map as immutableMap } from "immutable";

import { AvatarStack, DEFAULT_MAX_AVATARS } from "./avatar-stack";

const user_map = immutableMap(
  Object.fromEntries(
    Array.from({ length: 12 }, (_, i) => [
      `account-${i}`,
      immutableMap({ display_name: `User ${i}` }),
    ]),
  ),
);

jest.mock("@cocalc/frontend/app-framework", () => ({
  useTypedRedux: () => user_map,
}));

jest.mock("@cocalc/frontend/users/store", () => ({
  DEFAULT_COLOR: "rgb(170,170,170)",
}));

jest.mock("./avatar", () => ({
  Avatar: ({ account_id }: { account_id: string }) => (
    <span data-testid="avatar">{account_id}</span>
  ),
}));

function entriesN(n: number) {
  return Array.from({ length: n }, (_, i) => ({ account_id: `account-${i}` }));
}

describe("AvatarStack", () => {
  it("renders nothing when there is nobody to show", () => {
    const { container } = render(<AvatarStack entries={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders every avatar and no +N bubble when at the cutoff", () => {
    render(<AvatarStack entries={entriesN(DEFAULT_MAX_AVATARS)} />);
    expect(screen.getAllByTestId("avatar")).toHaveLength(DEFAULT_MAX_AVATARS);
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });

  it("clips past the cutoff and shows the remainder as +N", () => {
    render(<AvatarStack entries={entriesN(12)} />);
    expect(screen.getAllByTestId("avatar")).toHaveLength(DEFAULT_MAX_AVATARS);
    expect(
      screen.getByText(`+${12 - DEFAULT_MAX_AVATARS}`),
    ).toBeInTheDocument();
  });

  it("names the clipped users when the +N list is opened", () => {
    render(<AvatarStack entries={entriesN(7)} />);

    fireEvent.click(screen.getByRole("button"));

    // Users 5 and 6 are the ones that got clipped.
    expect(screen.getByText("User 5")).toBeInTheDocument();
    expect(screen.getByText("User 6")).toBeInTheDocument();
    expect(screen.queryByText("User 4")).toBeNull();
  });

  it("opens the +N list on click, so touch users can read it too", () => {
    // The shared Tooltip is removed entirely on touch and when
    // hide_button_tooltips is set, so a hover-only affordance is not enough.
    render(<AvatarStack entries={entriesN(7)} />);

    expect(screen.queryByText("User 5")).toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("User 5")).toBeInTheDocument();
  });

  it("preserves caller order in both the avatars and the +N list", () => {
    // UsersViewing passes entries already sorted by last activity, most
    // recent first; the stack must not reorder them.
    render(<AvatarStack entries={entriesN(8)} />);

    expect(screen.getAllByTestId("avatar").map((e) => e.textContent)).toEqual([
      "account-0",
      "account-1",
      "account-2",
      "account-3",
      "account-4",
    ]);

    // The clipped users keep that same order in the list.
    fireEvent.click(screen.getByRole("button"));
    const list = screen.getByText("User 5").parentElement!;
    expect(Array.from(list.children).map((e) => e.textContent)).toEqual([
      "User 5",
      "User 6",
      "User 7",
    ]);
  });

  it("summarizes when even the name list overflows", () => {
    render(<AvatarStack entries={entriesN(12)} maxNamesTooltip={3} />);
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("...and 4 more")).toBeInTheDocument();
  });

  it("exposes the +N overflow as a focusable, named control", () => {
    render(<AvatarStack entries={entriesN(8)} />);

    // Reachable and identifiable without the tooltip, which is pointer-only.
    const more = screen.getByRole("button", {
      name: "3 more: User 5, User 6, User 7",
    });
    more.focus();
    expect(more).toHaveFocus();
  });

  it("names the un-listed remainder in the +N accessible name too", () => {
    render(<AvatarStack entries={entriesN(12)} maxNamesTooltip={3} />);

    expect(
      screen.getByRole("button", {
        name: "7 more: User 5, User 6, User 7, and 4 more",
      }),
    ).toBeInTheDocument();
  });

  it("centers avatars in a flex row so image and letter avatars align (#126)", () => {
    const { container } = render(<AvatarStack entries={entriesN(3)} />);
    const row = container.firstElementChild as HTMLElement;
    expect(row.style.display).toBe("flex");
    expect(row.style.alignItems).toBe("center");
  });
});
