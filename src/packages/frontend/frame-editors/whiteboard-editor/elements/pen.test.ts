/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { drawCurve } from "./pen";
import type { Point } from "../types";

// Minimal 2d context that records what was drawn.
function mockCtx() {
  const ops: string[] = [];
  const points: Point[] = [];
  const ctx: any = {
    canvas: { width: 1000, height: 1000 },
    globalAlpha: 1,
    lineWidth: 0,
    beginPath: () => ops.push("beginPath"),
    closePath: () => ops.push("closePath"),
    moveTo: (x, y) => {
      ops.push("moveTo");
      points.push({ x, y });
    },
    lineTo: (x, y) => {
      ops.push("lineTo");
      points.push({ x, y });
    },
    quadraticCurveTo: (x0, y0, x, y) => {
      ops.push("quadraticCurveTo");
      points.push({ x: x0, y: y0 }, { x, y });
    },
    rect: (x, y, w, h) => {
      ops.push("rect");
      points.push({ x, y }, { x: x + w, y: y + h });
    },
    stroke: () => ops.push("stroke"),
    fill: () => ops.push("fill"),
  };
  return { ctx, ops, points };
}

function bbox(points: Point[]) {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    xMin: Math.min(...xs),
    xMax: Math.max(...xs),
    yMin: Math.min(...ys),
    yMax: Math.max(...ys),
  };
}

const horizontal: Point[] = [
  { x: 0, y: 50 },
  { x: 50, y: 50 },
  { x: 100, y: 50 },
  // doubles back over itself
  { x: 50, y: 50 },
];

describe("drawCurve", () => {
  it("draws a round pen with a single stroke, so a translucent color does not composite with itself", () => {
    const { ctx, ops } = mockCtx();
    drawCurve({ ctx, path: horizontal, radius: 10, opacity: 0.4 });
    expect(ops.filter((op) => op == "stroke").length).toBe(1);
    expect(ops.filter((op) => op == "fill").length).toBe(0);
    expect(ctx.globalAlpha).toBe(0.4);
    expect(ctx.lineWidth).toBe(20);
  });

  it("resets the opacity when the pen is not translucent", () => {
    const { ctx } = mockCtx();
    ctx.globalAlpha = 0.4; // e.g., left over from drawing a highlighter
    drawCurve({ ctx, path: horizontal, radius: 10 });
    expect(ctx.globalAlpha).toBe(1);
  });

  it("draws a chisel nib with a single fill", () => {
    const { ctx, ops } = mockCtx();
    drawCurve({
      ctx,
      path: horizontal,
      radius: 10,
      opacity: 0.4,
      nib: "chisel",
    });
    expect(ops.filter((op) => op == "fill").length).toBe(1);
    expect(ops.filter((op) => op == "stroke").length).toBe(0);
    expect(ops.filter((op) => op == "beginPath").length).toBe(1);
  });

  it("makes a chisel stroke as tall as the nib and no taller", () => {
    const { ctx, points } = mockCtx();
    drawCurve({ ctx, path: horizontal, radius: 10, nib: "chisel" });
    const { yMin, yMax, xMin, xMax } = bbox(points);
    // 2 * radius tall, centered on the path
    expect(yMin).toBe(40);
    expect(yMax).toBe(60);
    // the nib is thin, so a horizontal stroke barely extends past its ends
    expect(xMin).toBeGreaterThan(-5);
    expect(xMin).toBeLessThan(0);
    expect(xMax).toBeGreaterThan(100);
    expect(xMax).toBeLessThan(105);
  });

  it("makes a chisel stroke thin when it goes straight down", () => {
    const { ctx, points } = mockCtx();
    drawCurve({
      ctx,
      path: [
        { x: 50, y: 0 },
        { x: 50, y: 100 },
      ],
      radius: 10,
      nib: "chisel",
    });
    const { yMin, yMax, xMin, xMax } = bbox(points);
    expect(xMax - xMin).toBeLessThan(10);
    expect(yMin).toBe(-10);
    expect(yMax).toBe(110);
  });

  it("draws a single point", () => {
    const { ctx, ops } = mockCtx();
    drawCurve({ ctx, path: [{ x: 5, y: 5 }], radius: 3, nib: "chisel" });
    expect(ops).toContain("rect");
    expect(ops.filter((op) => op == "fill").length).toBe(1);
  });

  it("does nothing with an empty path", () => {
    const { ctx, ops } = mockCtx();
    drawCurve({ ctx, path: [], radius: 3 });
    expect(ops.length).toBe(0);
  });
});
