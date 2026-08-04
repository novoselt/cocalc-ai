/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  computeWorkFailureState,
  isSpotCapacityError,
  RetryableComputeWorkError,
} from "./worker";

describe("compute VM work failure state", () => {
  it("keeps scheduled Spot retries in recovering state", () => {
    const retry = new RetryableComputeWorkError(
      "Spot capacity is unavailable",
      new Date("2026-08-04T00:00:00.000Z"),
    );

    expect(computeWorkFailureState(retry)).toBe("recovering");
    expect(retry.retryAt.toISOString()).toBe("2026-08-04T00:00:00.000Z");
  });

  it("classifies terminal work errors as failed", () => {
    expect(
      computeWorkFailureState(new Error("invalid provider response")),
    ).toBe("failed");
  });

  it("recognizes provider capacity errors as retryable Spot failures", () => {
    expect(
      isSpotCapacityError(
        new Error("ZONE_RESOURCE_POOL_EXHAUSTED_WITH_DETAILS: unavailable"),
      ),
    ).toBe(true);
    expect(isSpotCapacityError(new Error("invalid machine type"))).toBe(false);
  });
});
