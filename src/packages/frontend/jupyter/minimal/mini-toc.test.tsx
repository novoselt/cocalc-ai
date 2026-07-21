/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";
import { fromJS } from "immutable";

const frameActions = {
  set_mode: jest.fn(),
  set_cur_id: jest.fn(),
  scroll: jest.fn(),
};

jest.mock(
  "@cocalc/frontend/frame-editors/jupyter-editor/cell-notebook/hook",
  () => ({
    __esModule: true,
    default: () => ({ current: frameActions }),
  }),
);

import { MiniTOC } from "./mini-toc";

const sectionBlocks = [
  { startCellId: "intro", cellIds: ["intro"], headingLevel: 0 },
  { startCellId: "one", cellIds: ["one", "code", "text"], headingLevel: 1 },
  { startCellId: "two", cellIds: ["two", "code-2"], headingLevel: 2 },
];

const cells = fromJS({
  intro: { id: "intro", cell_type: "code", input: "1" },
  one: { id: "one", cell_type: "markdown", input: "# First section" },
  code: { id: "code", cell_type: "code", input: "2" },
  text: { id: "text", cell_type: "markdown", input: "not a heading" },
  two: { id: "two", cell_type: "markdown", input: "## Second section" },
  "code-2": { id: "code-2", cell_type: "code", input: "3" },
});

describe("MiniTOC", () => {
  beforeEach(() => jest.clearAllMocks());

  it("shows heading sections and marks the current section", () => {
    const { container } = render(
      <MiniTOC
        sectionBlocks={sectionBlocks}
        currentBlockIndex={2}
        cells={cells}
        fontSize={20}
      />,
    );

    expect(screen.queryByText("intro")).toBeNull();
    expect(screen.getByText("First section")).toHaveClass("mini-toc-entry");
    expect(screen.getByText("Second section")).not.toHaveClass(
      "mini-toc-entry",
    );
    expect(container.textContent).toBe("First sectionSecond section");
  });

  it("selects and scrolls to a section on click", () => {
    render(
      <MiniTOC
        sectionBlocks={sectionBlocks}
        currentBlockIndex={1}
        cells={cells}
      />,
    );

    fireEvent.click(screen.getByText("Second section"));
    expect(frameActions.set_mode).toHaveBeenCalledWith("escape");
    expect(frameActions.set_cur_id).toHaveBeenCalledWith("two");
    expect(frameActions.scroll).toHaveBeenCalledWith("cell top");
  });

  it("runs only code cells in a section on double click", () => {
    const actions = {
      store: { get: jest.fn(() => cells) },
      runCells: jest.fn(),
      save_asap: jest.fn(),
    };
    render(
      <MiniTOC
        sectionBlocks={sectionBlocks}
        currentBlockIndex={1}
        cells={cells}
        actions={actions as any}
      />,
    );

    fireEvent.doubleClick(screen.getByText("First section"));
    expect(actions.runCells).toHaveBeenCalledWith(["code"]);
    expect(actions.save_asap).toHaveBeenCalledTimes(1);
  });
});
