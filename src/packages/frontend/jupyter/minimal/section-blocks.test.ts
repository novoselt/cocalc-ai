/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fromJS, List } from "immutable";

import {
  buildBlockLookup,
  computeSectionBlocks,
  computeSectionRunState,
  sectionBlocksEqual,
} from "./section-blocks";

function makeCells(
  spec: { id: string; cell_type?: string; input?: string }[],
): {
  cellList: List<string>;
  cells: any;
} {
  const cells: { [id: string]: any } = {};
  for (const { id, cell_type = "code", input = "" } of spec) {
    cells[id] = { id, cell_type, input };
  }
  return {
    cellList: List(spec.map((c) => c.id)),
    cells: fromJS(cells),
  };
}

describe("computeSectionBlocks", () => {
  it("groups cells into blocks split by markdown headings", () => {
    const { cellList, cells } = makeCells([
      { id: "a", input: "1+1" },
      { id: "b", cell_type: "markdown", input: "# Section 1" },
      { id: "c", input: "2+2" },
      { id: "d", input: "3+3" },
      { id: "e", cell_type: "markdown", input: "## Section 2" },
      { id: "f", input: "4+4" },
    ]);
    const blocks = computeSectionBlocks(cellList, cells);
    expect(blocks).toEqual([
      { startCellId: "a", cellIds: ["a"], headingLevel: 0 },
      { startCellId: "b", cellIds: ["b", "c", "d"], headingLevel: 1 },
      { startCellId: "e", cellIds: ["e", "f"], headingLevel: 2 },
    ]);
  });

  it("puts everything in one implicit block when there are no headings", () => {
    const { cellList, cells } = makeCells([
      { id: "a" },
      { id: "b", cell_type: "markdown", input: "just text, no heading" },
      { id: "c" },
    ]);
    const blocks = computeSectionBlocks(cellList, cells);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].cellIds).toEqual(["a", "b", "c"]);
    expect(blocks[0].headingLevel).toBe(0);
  });
});

describe("buildBlockLookup", () => {
  it("maps each cell to its block index, position and size", () => {
    const { cellList, cells } = makeCells([
      { id: "h", cell_type: "markdown", input: "# H" },
      { id: "x" },
      { id: "y" },
    ]);
    const lookup = buildBlockLookup(computeSectionBlocks(cellList, cells));
    expect(lookup.get("h")).toEqual({
      blockIndex: 0,
      positionInBlock: 0,
      blockSize: 3,
    });
    expect(lookup.get("y")).toEqual({
      blockIndex: 0,
      positionInBlock: 2,
      blockSize: 3,
    });
  });
});

describe("sectionBlocksEqual", () => {
  it("is true when an unrelated (non-heading) cell changes", () => {
    // Simulates the memoization contract in CellList: editing or executing a
    // code cell recomputes blocks, but they must compare equal so the previous
    // array (and all derived blockInfo objects) can be reused and unchanged
    // cells don't rerender.
    const spec = [
      { id: "h", cell_type: "markdown", input: "# H" },
      { id: "x", input: "1" },
    ];
    const one = makeCells(spec);
    const two = makeCells([spec[0], { id: "x", input: "2 /* edited */" }]);
    const blocksBefore = computeSectionBlocks(one.cellList, one.cells);
    const blocksAfter = computeSectionBlocks(two.cellList, two.cells);
    expect(blocksBefore).not.toBe(blocksAfter);
    expect(sectionBlocksEqual(blocksBefore, blocksAfter)).toBe(true);
  });

  it("is true when a heading's text changes but its level does not", () => {
    const one = makeCells([{ id: "h", cell_type: "markdown", input: "# A" }]);
    const two = makeCells([{ id: "h", cell_type: "markdown", input: "# B" }]);
    expect(
      sectionBlocksEqual(
        computeSectionBlocks(one.cellList, one.cells),
        computeSectionBlocks(two.cellList, two.cells),
      ),
    ).toBe(true);
  });

  it("is false when section structure actually changes", () => {
    const base = [
      { id: "h", cell_type: "markdown", input: "# H" },
      { id: "x" },
      { id: "y" },
    ];
    const one = makeCells(base);
    // "y" becomes a heading -> new block
    const two = makeCells([
      base[0],
      base[1],
      { id: "y", cell_type: "markdown", input: "## Y" },
    ]);
    expect(
      sectionBlocksEqual(
        computeSectionBlocks(one.cellList, one.cells),
        computeSectionBlocks(two.cellList, two.cells),
      ),
    ).toBe(false);
    // heading level change is also structural
    const three = makeCells([
      { id: "h", cell_type: "markdown", input: "## H" },
      base[1],
      base[2],
    ]);
    expect(
      sectionBlocksEqual(
        computeSectionBlocks(one.cellList, one.cells),
        computeSectionBlocks(three.cellList, three.cells),
      ),
    ).toBe(false);
  });
});

describe("computeSectionRunState", () => {
  const cells = (over: any = {}) =>
    fromJS({
      h: { id: "h", cell_type: "markdown", input: "# H" },
      x: { id: "x", cell_type: "code", input: "1", ...over.x },
      y: { id: "y", cell_type: "code", input: "2", ...over.y },
    });

  it("is null when all cells are idle", () => {
    expect(computeSectionRunState(["h", "x", "y"], cells())).toBeNull();
  });

  it("is running while any cell executes or is queued", () => {
    expect(
      computeSectionRunState(["h", "x", "y"], cells({ y: { state: "busy" } })),
    ).toBe("running");
    expect(
      computeSectionRunState(["h", "x", "y"], cells({ x: { state: "run" } })),
    ).toBe("running");
  });

  it("is error when a cell has a traceback and nothing runs", () => {
    expect(
      computeSectionRunState(
        ["h", "x", "y"],
        cells({ y: { output: { 0: { traceback: ["boom"] } } } }),
      ),
    ).toBe("error");
  });

  it("running takes precedence over error", () => {
    expect(
      computeSectionRunState(
        ["h", "x", "y"],
        cells({
          x: { output: { 0: { traceback: ["boom"] } } },
          y: { state: "busy" },
        }),
      ),
    ).toBe("running");
  });
});
