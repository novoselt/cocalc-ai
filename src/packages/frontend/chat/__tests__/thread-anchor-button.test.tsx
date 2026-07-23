/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@cocalc/frontend/components", () => ({
  Icon: ({ name }) => <span>{name}</span>,
  Tip: ({ children, title }) => <span data-tip={title}>{children}</span>,
  Tooltip: ({ children }) => <>{children}</>,
}));

import { ThreadAnchorButton } from "../thread-anchor-button";

describe("ThreadAnchorButton", () => {
  it("makes the compact thread label jump to its anchor", () => {
    const jumpToAnchor = jest.fn();
    const actions = {
      getThreadMetadata: () => ({ anchor: { id: "cell-56" } }),
      frameTreeActions: {
        jumpToAnchor,
        canJumpToAnchor: () => true,
        getAnchorLabel: () => "Cell 56",
      },
    } as any;

    render(
      <ThreadAnchorButton
        actions={actions}
        threadKey="thread-1"
        label="CELL 56"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /CELL 56/ }));
    expect(jumpToAnchor).toHaveBeenCalledWith("cell-56");
  });

  it("renders a deleted cell's stored title without a dead jump link", () => {
    const actions = {
      getThreadMetadata: () => ({ anchor: { id: "deleted-cell" } }),
      frameTreeActions: {
        jumpToAnchor: jest.fn(),
        canJumpToAnchor: () => false,
        getMissingAnchorMessage: () => "This cell was deleted",
        // A stale stored label must not override the explicit validity check.
        getAnchorLabel: () => "Cell 56",
      },
    } as any;

    render(
      <ThreadAnchorButton
        actions={actions}
        threadKey="thread-1"
        label="CELL 56"
      />,
    );

    expect(screen.getByText("CELL 56")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByLabelText("This cell was deleted")).toHaveTextContent(
      "trash",
    );
    expect(
      screen.getByLabelText("This cell was deleted").parentElement,
    ).toHaveAttribute("data-tip", "This cell was deleted");
  });

  it("keeps showing the thread label when there is no anchor", () => {
    const actions = {
      getThreadMetadata: () => ({}),
      frameTreeActions: {},
    } as any;

    render(
      <ThreadAnchorButton
        actions={actions}
        threadKey="thread-1"
        label="ORDINARY CHAT"
      />,
    );

    expect(screen.getByText("ORDINARY CHAT")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
