/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("antd", () => ({
  Button: ({ icon, onClick }) => (
    <button aria-label={icon?.props?.["data-icon"]} onClick={onClick}>
      {icon}
    </button>
  ),
}));

jest.mock("@cocalc/frontend/components", () => ({
  Icon: ({ name }) => <span data-icon={name}>{name}</span>,
  Tooltip: ({ children }) => <>{children}</>,
}));

jest.mock("@cocalc/frontend/components/sortable-list", () => ({
  DragHandle: ({ children }) => <div>{children}</div>,
}));

import { MinimalGutter } from "./minimal-gutter";

function renderGutter(overrides: any = {}) {
  const props = {
    id: "cell-1",
    index: 2,
    isCode: true,
    positionInBlock: 0,
    blockSize: 1,
    showBlockLine: true,
    cellRunState: "idle" as const,
    onRun: jest.fn(),
    onStop: jest.fn(),
    onInsertCell: jest.fn(),
    ...overrides,
  };
  render(<MinimalGutter {...props} />);
  return props;
}

describe("MinimalGutter", () => {
  it("runs idle cells and inserts a cell below", () => {
    const props = renderGutter();
    expect(screen.getByText("3")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "play" }));
    fireEvent.click(screen.getByRole("button", { name: "plus" }));
    expect(props.onRun).toHaveBeenCalledTimes(1);
    expect(props.onInsertCell).toHaveBeenCalledTimes(1);
  });

  it("shows stop instead of run while executing", () => {
    const props = renderGutter({ cellRunState: "running" });
    expect(screen.queryByRole("button", { name: "play" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "stop" }));
    expect(props.onStop).toHaveBeenCalledTimes(1);
    expect(props.onRun).not.toHaveBeenCalled();
  });

  it("hides mutating controls in read-only mode and shows protection state", () => {
    renderGutter({
      read_only: true,
      isNotEditable: true,
      isNotDeletable: true,
    });
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("lock")).toBeInTheDocument();
    expect(screen.getByText("ban")).toBeInTheDocument();
  });
});
