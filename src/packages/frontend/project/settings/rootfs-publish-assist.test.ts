/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { RootfsImageEntry } from "@cocalc/util/rootfs-images";
import { rootfsSupersedesOptions } from "./rootfs-publish-assist";

function image(id: string, label: string, version?: string): RootfsImageEntry {
  return {
    id,
    image: `cocalc.local/rootfs/${id}`,
    label,
    version,
    visibility: "public",
  };
}

describe("rootfsSupersedesOptions", () => {
  const source = image("r-p1", "R", "4.5.2.p1");
  const other = image("basic", "CoCalc Basic", "1.7");

  it("includes the source image when publishing a new release", () => {
    expect(
      rootfsSupersedesOptions({
        images: [source, other],
        publishMode: "copy",
        publishSourceEntryId: source.id,
      }),
    ).toContainEqual({ value: source.id, label: "R (4.5.2.p1)" });
  });

  it("excludes the source image when managing its catalog entry", () => {
    expect(
      rootfsSupersedesOptions({
        images: [source, other],
        publishMode: "manage",
        publishSourceEntryId: source.id,
      }),
    ).toEqual([{ value: other.id, label: "CoCalc Basic (1.7)" }]);
  });
});
