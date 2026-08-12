import type { RootfsImageEntry } from "@cocalc/util/rootfs-images";

import {
  groupRootfsVersionEntries,
  latestRootfsUpgradeEntry,
} from "./catalog-ui";

function image(
  id: string,
  version: string,
  opts: Partial<RootfsImageEntry> = {},
): RootfsImageEntry {
  return {
    id,
    label: "Minimal Image - Jupyter and Latex",
    image: `cocalc.local/rootfs/${id}`,
    family: "minimal-jupyter-latex",
    version,
    channel: "stable",
    ...opts,
  };
}

describe("rootfs catalog upgrade suggestions", () => {
  it("follows an explicit supersedes chain to the latest image", () => {
    const v11 = image("v1.1", "1.1");
    const v12 = image("v1.2", "1.2", {
      supersedes_image_id: "v1.1",
    });
    const v13 = image("v1.3", "1.3", {
      supersedes_image_id: "v1.2",
    });

    expect(
      latestRootfsUpgradeEntry({
        current: v11,
        images: [v12, v13],
      })?.id,
    ).toBe("v1.3");
  });

  it("uses the max reachable version if a supersedes chain loops", () => {
    const v12 = image("v1.2", "1.2", {
      supersedes_image_id: "v1.3",
    });
    const v13 = image("v1.3", "1.3", {
      supersedes_image_id: "v1.2",
    });

    expect(
      latestRootfsUpgradeEntry({
        current: v12,
        images: [v13],
      })?.id,
    ).toBe("v1.3");
  });

  it("falls back to the newest related version when no explicit chain exists", () => {
    const v11 = image("v1.1", "1.1");
    const v12 = image("v1.2", "1.2");
    const v13 = image("v1.3", "1.3");

    expect(
      latestRootfsUpgradeEntry({
        current: v11,
        images: [v12, v13],
      })?.id,
    ).toBe("v1.3");
  });

  it("prefers the newest related version over an older immediate supersedes target", () => {
    const v11 = image("v1.1", "1.1");
    const v12 = image("v1.2", "1.2", {
      supersedes_image_id: "v1.1",
    });
    const v13 = image("v1.3", "1.3");

    expect(
      latestRootfsUpgradeEntry({
        current: v11,
        images: [v12, v13],
      })?.id,
    ).toBe("v1.3");
  });

  it("does not suggest an official sibling for a custom image", () => {
    const base = image("basic-1.6", "1.6", {
      official: true,
      owner_id: "cocalc",
    });
    const custom = image("course-1.6", "1.6", {
      label: "LS30B",
      owner_id: "instructor",
      supersedes_image_id: base.id,
    });
    const officialNext = image("basic-1.7", "1.7", {
      official: true,
      owner_id: "cocalc",
      supersedes_image_id: base.id,
    });

    expect(
      latestRootfsUpgradeEntry({
        current: custom,
        images: [base, officialNext],
      }),
    ).toBeUndefined();
  });
});

describe("rootfs catalog version groups", () => {
  it("keeps the newest version prominent and every older version available", () => {
    const unrelated = image("python", "3.14", {
      family: "python",
      label: "Python",
    });
    const v11 = image("v1.1", "1.1");
    const v20 = image("v2.0", "2.0");
    const v19 = image("v1.9", "1.9");

    expect(
      groupRootfsVersionEntries([v11, unrelated, v20, v19]).map((group) => ({
        latest: group.latest.id,
        older: group.older.map((entry) => entry.id),
      })),
    ).toEqual([
      { latest: "python", older: [] },
      { latest: "v2.0", older: ["v1.9", "v1.1"] },
    ]);
  });

  it("does not combine versions from different channels or architectures", () => {
    const stable = image("stable", "2.0");
    const beta = image("beta", "3.0", { channel: "beta" });
    const arm = image("arm", "4.0", { arch: ["arm64"] });

    expect(
      groupRootfsVersionEntries([stable, beta, arm]).map(
        (group) => group.latest.id,
      ),
    ).toEqual(["stable", "beta", "arm"]);
  });

  it("groups a family when version numbers are included in its labels", () => {
    const python313 = image("python-3.13", "3.13", {
      family: "python",
      label: "Python 3.13",
    });
    const python314 = image("python-3.14", "3.14", {
      family: "python",
      label: "Python 3.14",
    });

    expect(groupRootfsVersionEntries([python313, python314])).toEqual([
      { latest: python314, older: [python313] },
    ]);
  });

  it("honors an explicit supersedes chain across renamed families", () => {
    const previous = image("old", "1.0", {
      family: "python-classic",
      label: "Classic Python",
    });
    const latest = image("new", "2.0", {
      family: "python",
      label: "Python Scientific",
      supersedes_image_id: previous.id,
    });

    expect(groupRootfsVersionEntries([previous, latest])).toEqual([
      { latest, older: [previous] },
    ]);
  });

  it("does not merge explicit chains across publisher scopes", () => {
    const official = image("official", "1.0", { official: true });
    const custom = image("custom", "2.0", {
      official: false,
      owner_id: "instructor",
      supersedes_image_id: official.id,
    });

    expect(
      groupRootfsVersionEntries([official, custom]).map((group) => ({
        latest: group.latest.id,
        older: group.older.map((entry) => entry.id),
      })),
    ).toEqual([
      { latest: "official", older: [] },
      { latest: "custom", older: [] },
    ]);
  });
});
