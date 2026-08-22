/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ComputeEnvironment } from "./config";

const LEGACY_VM_PREFIX = "cocalc-vm-";
const LEGACY_VOLUME_PREFIX = "cocalc-vol-";

function environmentPrefix(
  environment: ComputeEnvironment,
  resource: "vm" | "vol",
): string {
  // Production predates environment-scoped names. Preserve its namespace so
  // existing resources remain discoverable while isolating every non-prod bay
  // that may intentionally share the same cloud project or tenant.
  if (environment === "production") {
    return resource === "vm" ? LEGACY_VM_PREFIX : LEGACY_VOLUME_PREFIX;
  }
  return `cocalc-${environment}-${resource}-`;
}

export function managedComputeVmProviderPrefix(
  environment: ComputeEnvironment,
): string {
  return environmentPrefix(environment, "vm");
}

export function managedComputeVolumeProviderPrefix(
  environment: ComputeEnvironment,
): string {
  return environmentPrefix(environment, "vol");
}

export function managedComputeVmProviderName(
  id: string,
  environment: ComputeEnvironment,
): string {
  return `${managedComputeVmProviderPrefix(environment)}${id.replaceAll("-", "").slice(0, 24)}`;
}

export function managedComputeVolumeProviderName(
  id: string,
  environment: ComputeEnvironment,
): string {
  return `${managedComputeVolumeProviderPrefix(environment)}${id.replaceAll("-", "").slice(0, 24)}`;
}

export function managedComputeVmResourceBelongsToEnvironment(
  name: string | null | undefined,
  environment: ComputeEnvironment,
): boolean {
  return `${name ?? ""}`.startsWith(
    managedComputeVmProviderPrefix(environment),
  );
}

export function managedComputeVolumeResourceBelongsToEnvironment(
  name: string | null | undefined,
  environment: ComputeEnvironment,
): boolean {
  return `${name ?? ""}`.startsWith(
    managedComputeVolumeProviderPrefix(environment),
  );
}
