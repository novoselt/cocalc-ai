/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  canvasBackingStoreSize,
  MAX_CANVAS_BACKING_DIMENSION,
} from "./canvas-backing-store";

describe("canvasBackingStoreSize", () => {
  it("uses device-pixel resolution for ordinary canvases", () => {
    expect(
      canvasBackingStoreSize({
        cssWidth: 200,
        cssHeight: 500,
        devicePixelRatio: 2,
      }),
    ).toEqual({ width: 400, height: 1000, scaleX: 2, scaleY: 2 });
  });

  it("reduces resolution instead of exceeding the browser canvas limit", () => {
    const size = canvasBackingStoreSize({
      cssWidth: 200,
      cssHeight: 32_000,
      devicePixelRatio: 2,
    });
    expect(size.width).toBe(400);
    expect(size.height).toBe(MAX_CANVAS_BACKING_DIMENSION);
    expect(size.scaleX).toBe(2);
    expect(size.scaleY).toBe(MAX_CANVAS_BACKING_DIMENSION / 32_000);
  });
});
