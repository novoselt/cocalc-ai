/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

// Firefox rejects canvas dimensions above its platform-dependent maximum.
// Minimap canvases do not need full device-pixel resolution at extreme heights.
export const MAX_CANVAS_BACKING_DIMENSION = 16_384;

export function canvasBackingStoreSize({
  cssWidth,
  cssHeight,
  devicePixelRatio,
}: {
  cssWidth: number;
  cssHeight: number;
  devicePixelRatio: number;
}): {
  width: number;
  height: number;
  scaleX: number;
  scaleY: number;
} {
  const safeWidth = Math.max(1, cssWidth);
  const safeHeight = Math.max(1, cssHeight);
  const dpr = Math.max(1, Math.min(2, devicePixelRatio || 1));
  const width = Math.max(
    1,
    Math.min(MAX_CANVAS_BACKING_DIMENSION, Math.round(safeWidth * dpr)),
  );
  const height = Math.max(
    1,
    Math.min(MAX_CANVAS_BACKING_DIMENSION, Math.round(safeHeight * dpr)),
  );
  return {
    width,
    height,
    scaleX: width / safeWidth,
    scaleY: height / safeHeight,
  };
}
