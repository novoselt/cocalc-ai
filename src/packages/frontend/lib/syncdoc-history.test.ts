/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { canUseSyncDocHistory } from "./syncdoc-history";

describe("canUseSyncDocHistory", () => {
  it("rejects missing and non-ready documents", () => {
    expect(canUseSyncDocHistory(undefined)).toBe(false);
    expect(canUseSyncDocHistory({ isReady: () => false })).toBe(false);
  });

  it("allows locally ready documents without consulting network state", () => {
    const syncdoc = {
      isReady: () => true,
      is_live_connected: () => false,
    };

    expect(canUseSyncDocHistory(syncdoc)).toBe(true);
  });
});
