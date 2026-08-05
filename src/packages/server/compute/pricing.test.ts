/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { computeLeaseAuthorization } from "./pricing";

describe("compute VM lease authorization", () => {
  it("bounds Spot fallback by the hard lease TTL", () => {
    const result = computeLeaseAuthorization({
      pricingModel: "spot",
      allowOnDemandFallback: true,
      ttlMinutes: 10,
      spotHourlyUsd: 0.021,
      onDemandHourlyUsd: 0.068,
    });

    expect(result.authorizedFallbackHours).toBe(1);
    expect(result.maximumCostUsd).toBeCloseTo((10 / 60) * 0.068);
  });

  it("does not add mutually exclusive Spot and fallback runtimes", () => {
    const result = computeLeaseAuthorization({
      pricingModel: "spot",
      allowOnDemandFallback: true,
      ttlMinutes: 24 * 60,
      spotHourlyUsd: 0.021,
      onDemandHourlyUsd: 0.068,
    });

    expect(result.authorizedFallbackHours).toBe(24);
    expect(result.maximumCostUsd).toBeCloseTo(24 * 0.068);
  });

  it("uses the selected rate when fallback is not authorized", () => {
    const result = computeLeaseAuthorization({
      pricingModel: "spot",
      allowOnDemandFallback: false,
      ttlMinutes: 30,
      spotHourlyUsd: 0.021,
      onDemandHourlyUsd: 0.068,
    });

    expect(result.authorizedFallbackHours).toBe(0);
    expect(result.maximumCostUsd).toBeCloseTo(0.5 * 0.021);
  });
});
