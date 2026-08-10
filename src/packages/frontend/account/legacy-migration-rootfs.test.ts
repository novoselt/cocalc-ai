import type { RootfsImageEntry } from "@cocalc/util/rootfs-images";

import { firstLegacyMigrationRootfs } from "./legacy-migration-rootfs";

function image(id: string, tags?: string[]): RootfsImageEntry {
  return {
    id,
    image: `cocalc.local/rootfs/${id}`,
    tags,
  };
}

describe("firstLegacyMigrationRootfs", () => {
  it("selects the first listed image tagged legacy", () => {
    const first = image("first", ["official", "legacy"]);
    const second = image("second", ["legacy"]);

    expect(firstLegacyMigrationRootfs([image("basic"), first, second])).toBe(
      first,
    );
  });

  it("matches normalized tag casing and whitespace", () => {
    const legacy = image("legacy", [" Legacy "]);

    expect(firstLegacyMigrationRootfs([legacy])).toBe(legacy);
  });

  it("returns undefined without a legacy-tagged image", () => {
    expect(
      firstLegacyMigrationRootfs([image("basic", ["official"])]),
    ).toBeUndefined();
  });
});
