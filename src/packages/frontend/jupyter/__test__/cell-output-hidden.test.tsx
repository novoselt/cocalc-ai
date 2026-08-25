/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fromJS } from "immutable";
import { fireEvent, render, screen } from "@testing-library/react";

jest.mock("@cocalc/frontend/components", () => ({
  Icon: ({ name }) => <span>{name}</span>,
  Tooltip: ({ children }) => <>{children}</>,
}));

jest.mock("../cell-output-toggle", () => ({
  CollapsedOutput: () => null,
  OutputToggle: () => null,
}));

jest.mock("../output-messages/message", () => ({
  CellOutputMessages: () => null,
}));

jest.mock("../prompt/output", () => ({
  OutputPrompt: () => null,
}));

jest.mock("../raw-input", () => ({
  __esModule: true,
  default: () => null,
}));

import { CellOutput } from "../cell-output";

function hiddenOutputCell(id: string) {
  return fromJS({
    id,
    cell_type: "code",
    metadata: { jupyter: { outputs_hidden: true } },
    output: { 0: { data: { "text/plain": id } } },
  });
}

describe("Jupyter hidden cell output", () => {
  it("reveals only the hidden output whose ellipsis is clicked", () => {
    const set_jupyter_metadata = jest.fn();
    const actions = { set_jupyter_metadata } as any;

    render(
      <>
        <CellOutput
          actions={actions}
          cell={hiddenOutputCell("cell-1")}
          id="cell-1"
        />
        <CellOutput
          actions={actions}
          cell={hiddenOutputCell("cell-2")}
          id="cell-2"
        />
      </>,
    );

    const revealButtons = screen.getAllByRole("button", {
      name: "Show hidden cell output",
    });
    revealButtons[1].focus();
    expect(revealButtons[1]).toHaveFocus();
    fireEvent.click(revealButtons[1]);

    expect(set_jupyter_metadata).toHaveBeenCalledTimes(1);
    expect(set_jupyter_metadata).toHaveBeenCalledWith(
      "cell-2",
      "outputs_hidden",
      undefined,
    );
  });

  it("does not offer a reveal action in a read-only notebook", () => {
    render(
      <CellOutput
        actions={{ set_jupyter_metadata: jest.fn() } as any}
        cell={hiddenOutputCell("cell-1")}
        id="cell-1"
        readOnly
      />,
    );

    expect(
      screen.queryByRole("button", { name: "Show hidden cell output" }),
    ).toBeNull();
  });
});
