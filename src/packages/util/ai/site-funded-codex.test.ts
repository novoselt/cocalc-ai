/*
 *  This file is part of CoCalc: Copyright © 2026, SageMath, Inc.
 *  License: MS-RSL – see https://github.com/sagemathinc/cocalc-ai/blob/master/LICENSE.md
 */

import {
  computeSiteFundedCodexRequestCost,
  getSiteFundedCodexPrice,
  microusdToUsageUnits,
  usdToMicrousd,
} from "./site-funded-codex";

describe("site-funded Codex accounting", () => {
  it("prices ordinary Luna input and output without a cent minimum", () => {
    const cost = computeSiteFundedCodexRequestCost({
      model: "gpt-5.6-luna",
      usage: { inputTokens: 10_000, outputTokens: 500 },
    });
    expect(cost.costMicrousd).toBe(2_600);
    expect(microusdToUsageUnits(cost.costMicrousd)).toBe(0.26);
  });

  it("treats cached reads and writes as subsets of total input", () => {
    const cost = computeSiteFundedCodexRequestCost({
      model: "gpt-5.6-luna",
      usage: {
        inputTokens: 10_000,
        cachedInputTokens: 6_000,
        cacheWriteInputTokens: 1_000,
        outputTokens: 500,
      },
    });
    expect(cost.ordinaryInputTokens).toBe(3_000);
    expect(cost.costMicrousd).toBe(1_570);
  });

  it("bills reasoning tokens once as part of output", () => {
    const cost = computeSiteFundedCodexRequestCost({
      model: "gpt-5.6-luna",
      usage: {
        inputTokens: 0,
        outputTokens: 1_000,
        reasoningOutputTokens: 800,
      },
    });
    expect(cost.outputCostMicrousd).toBe(1_200);
    expect(cost.costMicrousd).toBe(1_200);
  });

  it("applies long-context multipliers per request", () => {
    const cost = computeSiteFundedCodexRequestCost({
      model: "gpt-5.6-luna",
      usage: { inputTokens: 272_001, outputTokens: 1_000 },
    });
    expect(cost.longContext).toBe(true);
    expect(cost.ordinaryInputCostMicrousd).toBe(108_801);
    expect(cost.outputCostMicrousd).toBe(1_800);
    expect(cost.costMicrousd).toBe(110_601);
  });

  it("includes separately reported provider tool fees", () => {
    const cost = computeSiteFundedCodexRequestCost({
      model: "gpt-5.6-luna",
      usage: {
        inputTokens: 0,
        outputTokens: 0,
        providerToolFeesMicrousd: 5_000,
      },
    });
    expect(cost.costMicrousd).toBe(5_000);
  });

  it("rejects unknown funded models", () => {
    expect(() => getSiteFundedCodexPrice("gpt-5.6-sol")).toThrow(
      "no exact site-funded Codex price",
    );
  });

  it("rejects malformed subset usage", () => {
    expect(() =>
      computeSiteFundedCodexRequestCost({
        model: "gpt-5.6-luna",
        usage: {
          inputTokens: 100,
          cachedInputTokens: 90,
          cacheWriteInputTokens: 20,
          outputTokens: 0,
        },
      }),
    ).toThrow("cannot exceed total input");
  });

  it("converts configured dollar limits exactly to microusd", () => {
    expect(usdToMicrousd("0.05")).toBe(50_000);
    expect(usdToMicrousd(100)).toBe(100_000_000);
  });
});
