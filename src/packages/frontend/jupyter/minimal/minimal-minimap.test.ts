/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fromJS, List, Set } from "immutable";
import { hash_string } from "@cocalc/util/misc";

import {
  buildMinimalMinimapEntries,
  computeMinimapLayout,
  getCellStatus,
  viewportFromSegments,
} from "./minimal-minimap";
import type { MinimalMinimapEntry, MinimapBarSegment } from "./minimal-minimap";

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
      // 120 = DEFAULT_CELL_HEIGHT for never-measured cells
      expect.objectContaining({ id: "b", pixelHeight: 120, isSelected: true }),
    ]);
  });

  it("hides cells inside a collapsed section only up to the next heading (flat block semantics)", () => {
    // Section blocks are flat: computeSectionBlocks starts a new block at
    // EVERY heading, so collapsing "# One" hides only the cells before
    // "## Child" — the rendered notebook keeps the Child section visible,
    // and the minimap must agree.
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

    expect(entries.map(({ id }) => id)).toEqual([
      "h1",
      "child",
      "nested",
      "h2",
    ]);
    expect(entries[0].pixelHeight).toBe(24);
  });

  it("collapsing a nested subsection hides only that subsection's cells", () => {
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
      collapsedSections: new globalThis.Set(["child"]),
      heightCache: {},
      lastExecInputHash: {},
    });

    expect(entries.map(({ id }) => id)).toEqual(["h1", "code", "child", "h2"]);
  });
});

describe("collapsed-section activity on the minimap", () => {
  const base = {
    h1: { id: "h1", cell_type: "markdown", input: "# One" },
    a: { id: "a", cell_type: "code", input: "1" },
    b: { id: "b", cell_type: "code", input: "2" },
    h2: { id: "h2", cell_type: "markdown", input: "# Two" },
  };
  const build = (cells) =>
    buildMinimalMinimapEntries({
      cellList: List(["h1", "a", "b", "h2"]),
      cells: fromJS(cells),
      collapsedSections: new globalThis.Set(["h1"]),
      heightCache: {},
      lastExecInputHash: {},
    });

  it("keeps the default markdown status when hidden cells are idle", () => {
    expect(build(base)[0].status).toBe("markdown");
  });

  it("surfaces running hidden cells on the collapsed entry", () => {
    const entries = build({
      ...base,
      b: { ...base.b, state: "busy" },
    });
    expect(entries[0].status).toBe("running");
    expect(entries.map(({ id }) => id)).toEqual(["h1", "h2"]);
  });

  it("running wins over queued and error", () => {
    const entries = build({
      ...base,
      a: { ...base.a, exec_count: 1, output: { 0: { traceback: ["boom"] } } },
      b: { ...base.b, state: "run" },
    });
    expect(entries[0].status).toBe("queued");
    const entries2 = build({
      ...base,
      a: { ...base.a, state: "busy" },
      b: { ...base.b, state: "run" },
    });
    expect(entries2[0].status).toBe("running");
  });

  it("surfaces errors of hidden cells when nothing is running", () => {
    const entries = build({
      ...base,
      b: { ...base.b, exec_count: 2, output: { 0: { traceback: ["boom"] } } },
    });
    expect(entries[0].status).toBe("error");
  });
});

describe("computeMinimapLayout", () => {
  const entry = (id: string, pixelHeight: number): MinimalMinimapEntry => ({
    id,
    pixelHeight,
    status: "idle",
    isCode: true,
    isCurrent: false,
    isSelected: false,
  });

  const stackBottom = (segments: MinimapBarSegment[]): number => {
    const last = segments[segments.length - 1];
    return last.top + last.height;
  };

  it("spans the minimap height for a few large cells", () => {
    const segments = computeMinimapLayout(
      [entry("a", 500), entry("b", 300), entry("c", 200)],
      400,
    );
    expect(segments).toHaveLength(3);
    // proportional: a is half the document
    expect(segments[0].height).toBeGreaterThan(segments[1].height);
    expect(stackBottom(segments)).toBeLessThanOrEqual(400);
    expect(stackBottom(segments)).toBeGreaterThan(390);
  });

  it("does not overflow with many small cells (min-height clamp)", () => {
    // 200 cells of 10px in a 300px minimap: unnormalized min heights + gaps
    // would need 800px
    const segments = computeMinimapLayout(
      Array.from({ length: 200 }, (_, i) => entry(`c${i}`, 10)),
      300,
    );
    expect(stackBottom(segments)).toBeLessThanOrEqual(300);
    expect(stackBottom(segments)).toBeGreaterThan(295);
    for (const seg of segments) {
      expect(seg.height).toBeGreaterThan(0);
    }
  });

  it("returns [] for empty input or non-positive height", () => {
    expect(computeMinimapLayout([], 100)).toEqual([]);
    expect(computeMinimapLayout([entry("a", 10)], 0)).toEqual([]);
  });
});

describe("viewportFromSegments", () => {
  const segments: MinimapBarSegment[] = [
    { entry: { id: "a" } as any, top: 0, height: 100 },
    { entry: { id: "b" } as any, top: 102, height: 100 },
    { entry: { id: "c" } as any, top: 204, height: 96 },
  ];

  it("anchors the viewport to the visible cell fractions", () => {
    const vp = viewportFromSegments(segments, {
      firstId: "a",
      firstFrac: 0.5,
      lastId: "b",
      lastFrac: 0.25,
    });
    expect(vp).toEqual({ top: 50, bottom: 127 });
  });

  it("is null without a range or with unknown cells", () => {
    expect(viewportFromSegments(segments, null)).toBeNull();
    expect(
      viewportFromSegments(segments, {
        firstId: "nope",
        firstFrac: 0,
        lastId: "b",
        lastFrac: 1,
      }),
    ).toBeNull();
  });
});
