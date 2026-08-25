/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { computeSnap, snapThreshold, SNAP_THRESHOLD } from "./snap";
import { GRID_MAJOR, GRID_MINOR } from "./elements/grid";
import type { Element, Rect } from "./types";

function elt(x: number, y: number, w: number, h: number, id = "a"): Element {
  return { id, x, y, w, h, z: 0, type: "text" } as Element;
}

const rect = (x: number, y: number, w = 50, h = 50): Rect => ({ x, y, w, h });

describe("snapThreshold", () => {
  it("is expressed in screen pixels, so data-space tolerance scales inversely", () => {
    expect(snapThreshold(1)).toBe(SNAP_THRESHOLD);
    // zoomed out: a screen pixel covers more data units, so the data-space
    // tolerance must grow to keep the on-screen feel constant.
    expect(snapThreshold(0.25)).toBe(SNAP_THRESHOLD * 4);
    // zoomed in: tolerance shrinks in data space.
    expect(snapThreshold(4)).toBe(SNAP_THRESHOLD / 4);
  });

  it("falls back to 1x for missing or nonsensical scales", () => {
    expect(snapThreshold(undefined)).toBe(SNAP_THRESHOLD);
    expect(snapThreshold(0)).toBe(SNAP_THRESHOLD);
    expect(snapThreshold(-2)).toBe(SNAP_THRESHOLD);
  });
});

describe("computeSnap threshold scaling", () => {
  // A wide neighbour, so its edge and centre targets (0, 100, 200) are all far
  // from the moving element's (x, x+25, x+50) except for the left-to-left pair
  // we want to exercise. With a same-size neighbour the centre axis would sit
  // closer than the edge and decide the result instead.
  const other = [elt(0, 0, 200, 50, "other")];

  it("does not snap a 20-unit gap at 100% zoom", () => {
    const { dx } = computeSnap({
      movingRect: rect(20, 0),
      otherElements: other,
      canvasScale: 1,
    });
    expect(dx).toBe(0);
  });

  it("snaps the same 20-unit gap when zoomed out to 25%", () => {
    // 20 data units is only 5 screen pixels at 25%, i.e. inside the 8px feel.
    const { dx } = computeSnap({
      movingRect: rect(20, 0),
      otherElements: other,
      canvasScale: 0.25,
    });
    expect(dx).toBe(-20);
  });

  it("keeps tolerance tight when zoomed in to 400%", () => {
    // 4 data units is 16 screen pixels at 400% -- deliberately not sticky.
    const { dx } = computeSnap({
      movingRect: rect(4, 0),
      otherElements: other,
      canvasScale: 4,
    });
    expect(dx).toBe(0);
    // and the same gap does snap at 100%, where it is only 4 screen pixels.
    expect(
      computeSnap({
        movingRect: rect(4, 0),
        otherElements: other,
        canvasScale: 1,
      }).dx,
    ).toBe(-4);
    // 1 data unit is 4 screen pixels, which is within tolerance.
    expect(
      computeSnap({
        movingRect: rect(1, 0),
        otherElements: other,
        canvasScale: 4,
      }).dx,
    ).toBe(-1);
  });
});

describe("computeSnap alignment", () => {
  it("returns a zero offset for an already-aligned element", () => {
    const { dx, dy } = computeSnap({
      movingRect: rect(0, 0),
      otherElements: [elt(0, 200, 50, 50, "other")],
      canvasScale: 1,
    });
    expect(dx).toBe(0);
    expect(dy).toBe(0);
  });

  it("aligns left edges and emits a vertical guide", () => {
    const result = computeSnap({
      movingRect: rect(3, 200),
      otherElements: [elt(0, 0, 50, 50, "other")],
      canvasScale: 1,
    });
    expect(result.dx).toBe(-3);
    expect(
      result.lines.some(
        (l) => l.orientation === "vertical" && l.position === 0,
      ),
    ).toBe(true);
  });

  it("snaps to the page border", () => {
    const { dx } = computeSnap({
      movingRect: rect(2, 500),
      otherElements: [],
      pageRect: { x: 0, y: 0, w: 1000, h: 1000 },
      canvasScale: 1,
    });
    expect(dx).toBe(-2);
  });
});

describe("computeSnap grid transitions", () => {
  // No other elements, so any snap must come from the grid.
  it("snaps to the major grid below 200% zoom", () => {
    const { dx } = computeSnap({
      movingRect: rect(GRID_MAJOR + 3, 0),
      otherElements: [],
      canvasScale: 1,
    });
    expect(dx).toBe(-3);
  });

  it("ignores minor grid lines below 200% zoom", () => {
    const { dx } = computeSnap({
      movingRect: rect(GRID_MINOR + 1, 0),
      otherElements: [],
      canvasScale: 1,
    });
    expect(dx).toBe(0);
  });

  it("snaps to the minor grid from 200% zoom on", () => {
    const { dx } = computeSnap({
      movingRect: rect(GRID_MINOR + 1, 0),
      otherElements: [],
      canvasScale: 2,
    });
    expect(dx).toBe(-1);
  });

  it("does no grid snapping when the scale is unknown", () => {
    const { dx } = computeSnap({
      movingRect: rect(GRID_MAJOR + 3, 0),
      otherElements: [],
    });
    expect(dx).toBe(0);
  });
});
