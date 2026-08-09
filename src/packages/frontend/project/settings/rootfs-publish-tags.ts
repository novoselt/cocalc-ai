/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { ROOTFS_PROJECT_PRESET_TAGS } from "@cocalc/frontend/rootfs/project-presets";
import { ONBOARDING_ROOTFS_ADMIN_TAGS } from "@cocalc/frontend/projects/onboarding/rootfs";

export type RootfsPublishTagOption = {
  label: string;
  value: string;
};

function isOnboardingTag(tag: string): boolean {
  return tag.trim().toLowerCase().startsWith("onboarding:");
}

export function buildRootfsPublishTagOptions({
  catalogTags,
  isAdmin,
}: {
  catalogTags: Array<string | undefined>;
  isAdmin: boolean;
}): RootfsPublishTagOption[] {
  const visibleCatalogTags = catalogTags.filter(
    (tag): tag is string => !!tag?.trim() && (isAdmin || !isOnboardingTag(tag)),
  );
  const tags = [
    ...visibleCatalogTags,
    ...Object.values(ROOTFS_PROJECT_PRESET_TAGS).flat(),
    ...(isAdmin ? ONBOARDING_ROOTFS_ADMIN_TAGS : []),
  ];

  return Array.from(new Set(tags.map((tag) => tag.trim()).filter(Boolean)))
    .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }))
    .map((tag) => ({ label: tag, value: tag }));
}
