/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { normalizeWheelDeltaY } from "./pinch-to-zoom";

// WheelEvent.deltaMode constants; see
// https://developer.mozilla.org/en-US/docs/Web/API/WheelEvent/deltaMode
const DOM_DELTA_PIXEL = 0;
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;

describe("normalizeWheelDeltaY", () => {
  it("passes pixel deltas through unchanged", () => {
    expect(normalizeWheelDeltaY({ deltaY: 100, deltaMode: DOM_DELTA_PIXEL })).toBe(
      100,
    );
    expect(normalizeWheelDeltaY({ deltaY: -53, deltaMode: DOM_DELTA_PIXEL })).toBe(
      -53,
    );
  });

  it("treats a missing deltaMode as pixels", () => {
    expect(normalizeWheelDeltaY({ deltaY: 100 })).toBe(100);
  });

  it("scales line deltas into pixels", () => {
    // Firefox and some mouse drivers report +-3 lines per notch. Left raw,
    // that is ~3px and zoom is effectively inert.
    const lines = normalizeWheelDeltaY({ deltaY: 3, deltaMode: DOM_DELTA_LINE });
    expect(lines).toBeGreaterThan(3);
    expect(lines).toBe(48);
    expect(normalizeWheelDeltaY({ deltaY: -3, deltaMode: DOM_DELTA_LINE })).toBe(
      -48,
    );
  });

  it("scales page deltas into pixels", () => {
    expect(normalizeWheelDeltaY({ deltaY: 1, deltaMode: DOM_DELTA_PAGE })).toBe(
      800,
    );
  });

  it("keeps a line notch and a pixel notch within the same order of magnitude", () => {
    // A Chrome notch is ~100px, a Firefox notch is 3 lines. After
    // normalization these should feel comparable rather than differing ~30x.
    const chrome = normalizeWheelDeltaY({ deltaY: 100, deltaMode: DOM_DELTA_PIXEL });
    const firefox = normalizeWheelDeltaY({ deltaY: 3, deltaMode: DOM_DELTA_LINE });
    const ratio = Math.max(chrome, firefox) / Math.min(chrome, firefox);
    expect(ratio).toBeLessThan(3);
  });

  it("preserves sign, so zoom direction is unaffected by delta mode", () => {
    for (const mode of [DOM_DELTA_PIXEL, DOM_DELTA_LINE, DOM_DELTA_PAGE]) {
      expect(normalizeWheelDeltaY({ deltaY: 5, deltaMode: mode })).toBeGreaterThan(0);
      expect(normalizeWheelDeltaY({ deltaY: -5, deltaMode: mode })).toBeLessThan(0);
    }
  });
});
