/*
 *  This file is part of CoCalc: Copyright © 2026, SageMath, Inc.
 *  License: MS-RSL – see https://github.com/sagemathinc/cocalc-ai/blob/master/LICENSE.md
 */

import { aiUsageUnitsToMicrousd } from "./usage-units";

describe("AI usage unit conversion", () => {
  it("converts membership units to provider-cost microusd", () => {
    expect(aiUsageUnitsToMicrousd(1)).toBe(10_000);
    expect(aiUsageUnitsToMicrousd(100)).toBe(1_000_000);
    expect(aiUsageUnitsToMicrousd(12.5)).toBe(125_000);
  });

  it("fails closed for absent or invalid limits", () => {
    expect(aiUsageUnitsToMicrousd(undefined)).toBe(0);
    expect(aiUsageUnitsToMicrousd(0)).toBe(0);
    expect(aiUsageUnitsToMicrousd(-1)).toBe(0);
    expect(aiUsageUnitsToMicrousd(Number.NaN)).toBe(0);
  });
});
