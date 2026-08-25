/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getEdgeEndpoints } from "./math";
import type { Rect } from "./types";

const r = (x: number, y: number, w: number, h: number): Rect => ({ x, y, w, h });

describe("getEdgeEndpoints", () => {
  it("connects bottom to top for vertically stacked rects", () => {
    const a = r(0, 0, 100, 50);
    const b = r(0, 200, 100, 50);
    const { start, end } = getEdgeEndpoints(a, b);
    expect(start).toEqual({ x: 50, y: 50 }); // bottom of a
    expect(end).toEqual({ x: 50, y: 200 }); // top of b
  });

  it("connects top to bottom when the target is above", () => {
    const a = r(0, 200, 100, 50);
    const b = r(0, 0, 100, 50);
    const { start, end } = getEdgeEndpoints(a, b);
    expect(start).toEqual({ x: 50, y: 200 }); // top of a
    expect(end).toEqual({ x: 50, y: 50 }); // bottom of b
  });

  it("connects right to left for horizontally placed rects", () => {
    const a = r(0, 0, 100, 50);
    const b = r(400, 0, 100, 50);
    const { start, end } = getEdgeEndpoints(a, b);
    expect(start).toEqual({ x: 100, y: 25 }); // right of a
    expect(end).toEqual({ x: 400, y: 25 }); // left of b
  });

  it("connects left to right when the target is to the left", () => {
    const a = r(400, 0, 100, 50);
    const b = r(0, 0, 100, 50);
    const { start, end } = getEdgeEndpoints(a, b);
    expect(start).toEqual({ x: 400, y: 25 }); // left of a
    expect(end).toEqual({ x: 100, y: 25 }); // right of b
  });

  it("accounts for aspect ratio, not just raw offsets", () => {
    // A very wide, short rect offset diagonally: the ray exits the long side
    // vertically even though |dx| exceeds |dy|.
    const wide = r(0, 0, 1000, 20);
    const other = r(300, 200, 100, 50);
    const { start } = getEdgeEndpoints(wide, other);
    expect(start.y).toBe(20); // bottom edge of the wide rect
  });

  it("degrades gracefully for coincident centers", () => {
    const a = r(0, 0, 100, 50);
    const { start, end } = getEdgeEndpoints(a, a);
    expect(start).toEqual({ x: 50, y: 50 });
    expect(end).toEqual({ x: 50, y: 0 });
  });

  it("tolerates zero-size rects without dividing by zero", () => {
    const a = r(0, 0, 0, 0);
    const b = r(100, 100, 0, 0);
    const { start, end } = getEdgeEndpoints(a, b);
    expect(Number.isFinite(start.x)).toBe(true);
    expect(Number.isFinite(start.y)).toBe(true);
    expect(Number.isFinite(end.x)).toBe(true);
    expect(Number.isFinite(end.y)).toBe(true);
  });
});
