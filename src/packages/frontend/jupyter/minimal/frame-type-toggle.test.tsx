/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";

let frameContext: any;

jest.mock("@cocalc/frontend/components", () => ({
  Icon: () => null,
  Tooltip: ({ children }) => <>{children}</>,
}));

jest.mock("@cocalc/frontend/frame-editors/frame-tree/frame-context", () => ({
  useFrameContext: () => frameContext,
}));

import {
  SwitchToMinimalButton,
  SwitchToRegularButton,
} from "./frame-type-toggle";

function contextFor(types: Record<string, string>) {
  const set_frame_type = jest.fn();
  return {
    id: "active",
    actions: {
      _get_leaf_ids: () =>
        Object.fromEntries(Object.keys(types).map((id) => [id, true])),
      _get_frame_type: (id: string) => types[id],
      set_frame_type,
    },
    set_frame_type,
  };
}

describe("minimal notebook frame-type toggles", () => {
  it("switches a single frame in either direction", () => {
    const context = contextFor({ active: "jupyter_cell_notebook" });
    frameContext = context;
    render(
      <>
        <SwitchToMinimalButton />
        <SwitchToRegularButton />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Minimal" }));
    fireEvent.click(screen.getByRole("button", { name: "Regular" }));
    expect(context.set_frame_type).toHaveBeenNthCalledWith(
      1,
      "active",
      "jupyter_minimal",
    );
    expect(context.set_frame_type).toHaveBeenNthCalledWith(
      2,
      "active",
      "jupyter_cell_notebook",
    );
  });

  it("hides a target that already exists in a split view", () => {
    frameContext = contextFor({
      active: "jupyter_cell_notebook",
      other: "jupyter_minimal",
    });
    const { rerender } = render(<SwitchToMinimalButton />);
    expect(screen.queryByRole("button", { name: "Minimal" })).toBeNull();

    frameContext = contextFor({
      active: "jupyter_minimal",
      other: "jupyter_cell_notebook",
    });
    rerender(<SwitchToRegularButton />);
    expect(screen.queryByRole("button", { name: "Regular" })).toBeNull();
  });
});
