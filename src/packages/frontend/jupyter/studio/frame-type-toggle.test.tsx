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
  SwitchToStudioButton,
  SwitchToClassicButton,
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

describe("studio notebook frame-type toggles", () => {
  it("switches a single frame in either direction", () => {
    const context = contextFor({ active: "jupyter_cell_notebook" });
    frameContext = context;
    render(
      <>
        <SwitchToStudioButton />
        <SwitchToClassicButton />
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Studio" }));
    fireEvent.click(screen.getByRole("button", { name: "Classic" }));
    expect(context.set_frame_type).toHaveBeenNthCalledWith(
      1,
      "active",
      "jupyter_studio",
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
      other: "jupyter_studio",
    });
    const { rerender } = render(<SwitchToStudioButton />);
    expect(screen.queryByRole("button", { name: "Studio" })).toBeNull();

    frameContext = contextFor({
      active: "jupyter_studio",
      other: "jupyter_cell_notebook",
    });
    rerender(<SwitchToClassicButton />);
    expect(screen.queryByRole("button", { name: "Classic" })).toBeNull();
  });
});
