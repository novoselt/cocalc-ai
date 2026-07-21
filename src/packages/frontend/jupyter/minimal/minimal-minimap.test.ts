/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fromJS, List, Set } from "immutable";
import { hash_string } from "@cocalc/util/misc";

import { buildMinimalMinimapEntries, getCellStatus } from "./minimal-minimap";

describe("minimal minimap cell state", () => {
  it.each([
    [{ state: "busy" }, "running"],
    [{ state: "run" }, "queued"],
    [{ cell_type: "markdown" }, "markdown"],
    [{ input: "x" }, "dirty"],
    [{ input: "x", exec_count: 1 }, "idle"],
  ])("classifies %p as %s", (attrs, expected) => {
    expect(
      getCellStatus(fromJS({ id: "cell", cell_type: "code", ...attrs }), {}),
    ).toBe(expected);
  });

  it("detects errors and edits made since execution", () => {
    const error = fromJS({
      id: "error",
      cell_type: "code",
      exec_count: 1,
      output: { 0: { traceback: ["boom"] } },
    });
    expect(getCellStatus(error, {})).toBe("error");

    const edited = fromJS({
      id: "edited",
      cell_type: "code",
      input: "after",
      exec_count: 1,
    });
    expect(getCellStatus(edited, { edited: hash_string("before") })).toBe(
      "dirty",
    );
  });
});

describe("buildMinimalMinimapEntries", () => {
  it("uses cached heights and preserves current/selected state", () => {
    const cells = fromJS({
      a: { id: "a", cell_type: "code", input: "a", exec_count: 1 },
      b: { id: "b", cell_type: "markdown", input: "text" },
    });
    const entries = buildMinimalMinimapEntries({
      cellList: List(["a", "b"]),
      cells,
      collapsedSections: new globalThis.Set(),
      heightCache: { a: 90 },
      lastExecInputHash: {},
      curId: "a",
      selIds: Set(["b"]),
    });

    expect(entries).toEqual([
      expect.objectContaining({ id: "a", pixelHeight: 90, isCurrent: true }),
      expect.objectContaining({ id: "b", pixelHeight: 60, isSelected: true }),
    ]);
  });

  it("hides cells inside collapsed sections until the next peer heading", () => {
    const cells = fromJS({
      h1: { id: "h1", cell_type: "markdown", input: "# One" },
      code: { id: "code", cell_type: "code", input: "1" },
      child: { id: "child", cell_type: "markdown", input: "## Child" },
      nested: { id: "nested", cell_type: "code", input: "2" },
      h2: { id: "h2", cell_type: "markdown", input: "# Two" },
    });
    const entries = buildMinimalMinimapEntries({
      cellList: List(["h1", "code", "child", "nested", "h2"]),
      cells,
      collapsedSections: new globalThis.Set(["h1"]),
      heightCache: {},
      lastExecInputHash: {},
    });

    expect(entries.map(({ id }) => id)).toEqual(["h1", "h2"]);
    expect(entries[0].pixelHeight).toBe(24);
  });
});
