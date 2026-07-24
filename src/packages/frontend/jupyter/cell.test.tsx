/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fromJS, Map } from "immutable";
import { render, screen } from "@testing-library/react";

let mockMinimalCellProps: any;
let mockCellOutputProps: any;

jest.mock("@cocalc/frontend/app-framework", () => ({
  React: require("react"),
  CSS: {},
  useDelayedRender: () => true,
}));

jest.mock("@cocalc/frontend/components", () => ({
  Icon: ({ name }) => <span>{name}</span>,
  Tip: ({ children }) => <>{children}</>,
}));

jest.mock("@cocalc/frontend/feature", () => ({
  IS_TOUCH: false,
}));

jest.mock(
  "@cocalc/frontend/frame-editors/jupyter-editor/cell-notebook/hook",
  () => ({
    __esModule: true,
    default: () => ({ current: undefined }),
  }),
);

jest.mock("./cell-input", () => ({
  CellInput: () => null,
}));

jest.mock("./cell-output", () => ({
  CellOutput: (props) => {
    mockCellOutputProps = props;
    return <div data-testid="cell-output" />;
  },
}));

jest.mock("./insert-cell", () => ({
  InsertCell: () => null,
}));

jest.mock("./minimal/minimal-cell", () => ({
  MinimalCell: (props) => {
    mockMinimalCellProps = props;
    return <div data-testid="minimal-cell" />;
  },
}));

jest.mock("./nbgrader/cell-metadata", () => ({
  NBGraderMetadata: () => null,
}));

jest.mock("./prompt/base", () => ({
  INPUT_PROMPT_COLOR: "#000",
}));

import { Cell } from "./cell";

describe("Cell in minimal view mode", () => {
  beforeEach(() => {
    mockMinimalCellProps = undefined;
    mockCellOutputProps = undefined;
  });

  const cell = fromJS({ id: "cell-1", cell_type: "code", input: "1+1" });

  it("forwards transient execution state (stdin, runOverlay, isDragging) to MinimalCell", () => {
    const stdin = fromJS({ id: "cell-1", prompt: "value: " });
    const runOverlay = fromJS({ state: "pending" });
    render(
      <Cell
        cell={cell}
        cm_options={Map()}
        mode="escape"
        font_size={14}
        cellViewMode="minimal"
        stdin={stdin}
        runOverlay={runOverlay}
        isDragging={true}
      />,
    );
    expect(screen.getByTestId("minimal-cell")).toBeInTheDocument();
    expect(mockMinimalCellProps.stdin).toBe(stdin);
    expect(mockMinimalCellProps.runOverlay).toBe(runOverlay);
    expect(mockMinimalCellProps.isDragging).toBe(true);
    // and the regular cell renderer is not used
    expect(screen.queryByTestId("cell-output")).toBeNull();
  });

  it("uses the regular renderer when cellViewMode is not minimal", () => {
    render(
      <Cell cell={cell} cm_options={Map()} mode="escape" font_size={14} />,
    );
    expect(screen.queryByTestId("minimal-cell")).toBeNull();
    expect(screen.getByTestId("cell-output")).toBeInTheDocument();
    expect(mockCellOutputProps.stdin).toBeUndefined();
  });
});
