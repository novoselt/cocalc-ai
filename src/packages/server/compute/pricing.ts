/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export function computeLeaseAuthorization({
  pricingModel,
  allowOnDemandFallback,
  ttlMinutes,
  spotHourlyUsd,
  onDemandHourlyUsd,
}: {
  pricingModel: "spot" | "on_demand";
  allowOnDemandFallback: boolean;
  ttlMinutes: number;
  spotHourlyUsd: number;
  onDemandHourlyUsd: number;
}) {
  const ttlHours = ttlMinutes / 60;
  const fallbackAllowed =
    pricingModel === "spot" && allowOnDemandFallback === true;
  const authorizedFallbackHours = fallbackAllowed
    ? Math.min(24, Math.ceil(ttlHours))
    : 0;
  // Spot and on-demand execution are mutually exclusive, and hard TTL applies
  // to both. The most expensive authorized path is therefore on-demand for
  // the entire remaining lease, not Spot plus a second fallback lease.
  const maximumHourlyUsd = fallbackAllowed
    ? Math.max(spotHourlyUsd, onDemandHourlyUsd)
    : pricingModel === "spot"
      ? spotHourlyUsd
      : onDemandHourlyUsd;
  return {
    authorizedFallbackHours,
    maximumCostUsd: ttlHours * maximumHourlyUsd,
  };
}
