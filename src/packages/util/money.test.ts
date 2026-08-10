/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { moneyRoundToCents } from "./money";

describe("moneyRoundToCents", () => {
  it.each([
    ["1.0049", "1"],
    ["1.005", "1.01"],
    ["-1.0049", "-1"],
    ["-1.005", "-1.01"],
    ["0.004", "0"],
    ["0.006", "0.01"],
  ])("rounds %s to %s", (value, expected) => {
    expect(moneyRoundToCents(value).toString()).toBe(expected);
  });
});
