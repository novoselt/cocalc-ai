/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  ManagedComputeFundingMode,
  ManagedComputeProviderId,
} from "@cocalc/conat/hub/api/compute";

export function providerEgressIsFree(
  provider: ManagedComputeProviderId,
): boolean {
  return provider === "nebius";
}

export function egressRateLabel({
  provider,
  funding_mode,
}: {
  provider: ManagedComputeProviderId;
  funding_mode: ManagedComputeFundingMode;
}): string {
  if (providerEgressIsFree(provider)) return "Egress is free";
  return `Egress $0.10/GB${funding_mode === "site-funded" ? " · paid by site" : ""}`;
}
