/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  HostCatalog,
  HostCatalogRegion,
  HostCatalogZone,
} from "@cocalc/conat/hub/api/hosts";

export function regionFromComputeZone(zone: string): string {
  return `${zone ?? ""}`
    .trim()
    .toLowerCase()
    .replace(/-[a-z]$/, "");
}

export function requireComputeZoneInRegions(
  zone: string,
  regions?: ReadonlySet<string>,
) {
  if (regions && !regions.has(regionFromComputeZone(zone))) {
    throw new Error(
      `managed compute has no configured regional subnetwork for zone '${zone}'`,
    );
  }
}

export function restrictHostCatalogToRegions(
  catalog: HostCatalog,
  regions?: ReadonlySet<string>,
): HostCatalog {
  if (!regions) return catalog;
  return {
    ...catalog,
    entries: catalog.entries
      .filter(
        ({ kind, scope }) =>
          (kind !== "machine_types" && kind !== "gpu_types") ||
          !scope.startsWith("zone/") ||
          regions.has(regionFromComputeZone(scope.slice("zone/".length))),
      )
      .map((entry) => {
        if (entry.kind === "regions" && entry.scope === "global") {
          return {
            ...entry,
            payload: (entry.payload as HostCatalogRegion[]).filter(({ name }) =>
              regions.has(name),
            ),
          };
        }
        if (entry.kind === "zones" && entry.scope === "global") {
          return {
            ...entry,
            payload: (entry.payload as HostCatalogZone[]).filter(
              ({ name, region }) =>
                regions.has(region || regionFromComputeZone(name)),
            ),
          };
        }
        return entry;
      }),
  };
}

export function defaultComputeZone(catalog: HostCatalog): string {
  const zones = catalog.entries.find(
    ({ kind, scope }) => kind === "zones" && scope === "global",
  )?.payload as HostCatalogZone[] | undefined;
  return (
    zones?.find(({ status }) => !status || status === "UP")?.name ??
    "us-central1-a"
  );
}
