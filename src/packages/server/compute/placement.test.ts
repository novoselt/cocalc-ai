/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  defaultComputeZone,
  requireComputeZoneInRegion,
  restrictHostCatalogToRegion,
} from "./placement";

const catalog = {
  provider: "gcp",
  entries: [
    {
      kind: "regions",
      scope: "global",
      payload: [
        { name: "us-central1", zones: ["us-central1-a"] },
        { name: "us-south1", zones: ["us-south1-c"] },
      ],
    },
    {
      kind: "zones",
      scope: "global",
      payload: [
        { name: "us-central1-a", region: "us-central1", status: "UP" },
        { name: "us-south1-c", region: "us-south1", status: "UP" },
      ],
    },
    { kind: "machine_types", scope: "zone/us-central1-a", payload: [] },
    { kind: "machine_types", scope: "zone/us-south1-c", payload: [] },
    { kind: "prices", scope: "global", payload: { version: 1 } },
  ],
};

describe("managed compute placement", () => {
  it("limits the shared host catalog to the configured network region", () => {
    const restricted = restrictHostCatalogToRegion(catalog, "us-central1");
    expect(
      restricted.entries.find(({ kind }) => kind === "regions")?.payload,
    ).toEqual([{ name: "us-central1", zones: ["us-central1-a"] }]);
    expect(
      restricted.entries.find(({ kind }) => kind === "zones")?.payload,
    ).toEqual([{ name: "us-central1-a", region: "us-central1", status: "UP" }]);
    expect(
      restricted.entries.some(({ scope }) => scope === "zone/us-south1-c"),
    ).toBe(false);
    expect(restricted.entries.some(({ kind }) => kind === "prices")).toBe(true);
    expect(defaultComputeZone(restricted, "us-central1")).toBe("us-central1-a");
  });

  it("rejects zones outside the configured network region", () => {
    expect(() =>
      requireComputeZoneInRegion("us-south1-c", "us-central1"),
    ).toThrow("available only in us-central1");
    expect(() =>
      requireComputeZoneInRegion("us-central1-a", "us-central1"),
    ).not.toThrow();
  });
});
