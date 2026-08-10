/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { ONBOARDING_ROOTFS_ADMIN_TAGS } from "@cocalc/frontend/projects/onboarding/rootfs";
import { buildRootfsPublishTagOptions } from "./rootfs-publish-tags";

function values(isAdmin: boolean): string[] {
  return buildRootfsPublishTagOptions({
    catalogTags: ["python", "onboarding:existing", "python", undefined],
    isAdmin,
  }).map(({ value }) => value);
}

describe("buildRootfsPublishTagOptions", () => {
  it("offers every documented onboarding tag to admins", () => {
    const tags = values(true);
    expect(tags).toEqual(expect.arrayContaining(ONBOARDING_ROOTFS_ADMIN_TAGS));
    expect(tags).toContain("onboarding:existing");
    expect(tags.filter((tag) => tag === "python")).toHaveLength(1);
  });

  it("hides all onboarding tags from non-admins", () => {
    const tags = values(false);
    expect(tags).toContain("python");
    expect(tags).toContain("preset:standard");
    expect(tags.some((tag) => tag.startsWith("onboarding:"))).toBe(false);
  });
});
