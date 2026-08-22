/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { QUICK_CREATE_MAP, isQuickCreateAvailable } from "./launcher-catalog";

describe("X11 launcher", () => {
  test("is part of the quick-create catalog", () => {
    expect(QUICK_CREATE_MAP.x11).toMatchObject({
      id: "x11",
      ext: "x11",
      label: "X11",
      icon: "window-restore",
    });
  });

  test("respects project availability", () => {
    expect(isQuickCreateAvailable("x11", { x11: true })).toBe(true);
    expect(isQuickCreateAvailable("x11", { x11: false })).toBe(false);
  });
});
