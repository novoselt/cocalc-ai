/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { isFixedTab, isFixedTabAvailableInLite } from "./fixed-tab-ids";

describe("fixed project tab ids", () => {
  it("recognizes fixed tabs without loading their UI configuration", () => {
    expect(isFixedTab("files")).toBe(true);
    expect(isFixedTab("settings")).toBe(true);
    expect(isFixedTab("not-a-tab")).toBe(false);
    expect(isFixedTab(undefined)).toBe(false);
  });

  it("identifies tabs that are not available in Lite", () => {
    expect(isFixedTabAvailableInLite("files")).toBe(true);
    expect(isFixedTabAvailableInLite("rootfs")).toBe(false);
    expect(isFixedTabAvailableInLite("settings")).toBe(false);
    expect(isFixedTabAvailableInLite("vms")).toBe(false);
  });
});
