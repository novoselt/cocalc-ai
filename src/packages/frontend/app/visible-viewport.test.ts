/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getVisibleViewportBottom } from "./visible-viewport";

describe("getVisibleViewportBottom", () => {
  it("uses the visual viewport bottom edge", () => {
    expect(
      getVisibleViewportBottom({
        innerHeight: 900,
        visualViewport: {
          height: 540.4,
          offsetTop: 17.4,
        } as VisualViewport,
      }),
    ).toBe(558);
  });

  it("falls back to the layout viewport height", () => {
    expect(
      getVisibleViewportBottom({
        innerHeight: 731.6,
        visualViewport: null,
      }),
    ).toBe(732);
  });

  it("ignores an invalid visual viewport", () => {
    expect(
      getVisibleViewportBottom({
        innerHeight: 640,
        visualViewport: {
          height: 0,
          offsetTop: 0,
        } as VisualViewport,
      }),
    ).toBe(640);
  });
});
