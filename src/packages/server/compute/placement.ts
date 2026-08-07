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

export function requireComputeZoneInRegion(zone: string, region?: string) {
  if (region && regionFromComputeZone(zone) !== region) {
    throw new Error(
      `managed compute is currently available only in ${region}; zone '${zone}' uses a different regional network`,
    );
  }
}

export function restrictHostCatalogToRegion(
  catalog: HostCatalog,
  region?: string,
): HostCatalog {
  if (!region) return catalog;
  const zonePrefix = `${region}-`;
  return {
    ...catalog,
    entries: catalog.entries
      .filter(
        ({ kind, scope }) =>
          (kind !== "machine_types" && kind !== "gpu_types") ||
          !scope.startsWith("zone/") ||
          scope.slice("zone/".length).startsWith(zonePrefix),
      )
      .map((entry) => {
        if (entry.kind === "regions" && entry.scope === "global") {
          return {
            ...entry,
            payload: (entry.payload as HostCatalogRegion[]).filter(
              ({ name }) => name === region,
            ),
          };
        }
        if (entry.kind === "zones" && entry.scope === "global") {
          return {
            ...entry,
            payload: (entry.payload as HostCatalogZone[]).filter(
              ({ name, region: zoneRegion }) =>
                zoneRegion === region || name.startsWith(zonePrefix),
            ),
          };
        }
        return entry;
      }),
  };
}

export function defaultComputeZone(
  catalog: HostCatalog,
  region?: string,
): string {
  const zones = catalog.entries.find(
    ({ kind, scope }) => kind === "zones" && scope === "global",
  )?.payload as HostCatalogZone[] | undefined;
  return (
    zones?.find(({ status }) => !status || status === "UP")?.name ??
    (region ? `${region}-a` : "us-central1-a")
  );
}
