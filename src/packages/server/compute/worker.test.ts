/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  computeWorkFailureState,
  computeRuntimeMetadata,
  computePostStopTransition,
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

  it("preserves and refreshes provider network identity", () => {
    expect(
      computeRuntimeMetadata(
        {
          private_ip: "10.0.0.1",
          internal_hostname: "old.internal",
          boot_disk_name: "disk-1",
        },
        {
          private_ip: "10.0.0.2",
          internal_hostname: "new.internal",
          metadata: { machine_type: "e2-standard-2" },
        },
      ),
    ).toEqual({
      private_ip: "10.0.0.2",
      internal_hostname: "new.internal",
      boot_disk_name: "disk-1",
      machine_type: "e2-standard-2",
    });
  });

  it("honors newer durable intent after a provider stop completes", () => {
    expect(computePostStopTransition("stopped")).toEqual({
      state: "stopped",
      action: undefined,
    });
    expect(computePostStopTransition("running")).toEqual({
      state: "starting",
      action: "start",
    });
    expect(computePostStopTransition("deleted")).toEqual({
      state: "deleting",
      action: "delete",
    });
  });
});
