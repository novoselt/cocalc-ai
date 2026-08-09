/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { RootfsImageEntry } from "@cocalc/util/rootfs-images";
import { isNewProjectRootfsSelectable } from "../create-project-rootfs";

export type OnboardingProjectKind =
  | "jupyter-python"
  | "jupyter-r"
  | "jupyter-julia"
  | "sage"
  | "code"
  | "codex"
  | "latex"
  | "teaching";

export type OnboardingRootfsSelection = {
  image: string;
  image_id?: string;
  entry?: RootfsImageEntry;
  matched_tag?: string;
};

// Sites can change images without changing onboarding code. The first tag is
// the stable convention; later tags keep existing catalogs useful.
export const ONBOARDING_ROOTFS_TAGS: Record<
  OnboardingProjectKind,
  readonly string[]
> = {
  "jupyter-python": [
    "onboarding:jupyter-python",
    "onboarding:jupyter",
    "jupyter",
    "preset:standard",
  ],
  "jupyter-r": [
    "onboarding:jupyter-r",
    "onboarding:jupyter",
    "r",
    "jupyter",
    "preset:standard",
  ],
  "jupyter-julia": [
    "onboarding:jupyter-julia",
    "onboarding:jupyter",
    "julia",
    "jupyter",
    "preset:standard",
  ],
  sage: [
    "onboarding:sage",
    "onboarding:math",
    "sagemath",
    "sage",
    "preset:standard",
  ],
  code: ["onboarding:code", "onboarding:standard", "preset:standard"],
  codex: ["onboarding:codex", "onboarding:code", "preset:standard"],
  latex: [
    "onboarding:latex",
    "onboarding:documents",
    "latex",
    "preset:standard",
  ],
  teaching: ["onboarding:teaching", "preset:teaching"],
};

function normalizedTags(entry: RootfsImageEntry): Set<string> {
  return new Set(
    (entry.tags ?? [])
      .map((tag) => `${tag}`.trim().toLowerCase())
      .filter(Boolean),
  );
}

function tagRank(
  entry: RootfsImageEntry,
  tags: readonly string[],
): number | undefined {
  const available = normalizedTags(entry);
  const rank = tags.findIndex((tag) => available.has(tag));
  return rank < 0 ? undefined : rank;
}

function compareCandidates(
  a: { entry: RootfsImageEntry; rank: number },
  b: { entry: RootfsImageEntry; rank: number },
): number {
  if (a.rank !== b.rank) return a.rank - b.rank;
  if (!!a.entry.deprecated !== !!b.entry.deprecated) {
    return a.entry.deprecated ? 1 : -1;
  }
  if (!!a.entry.official !== !!b.entry.official) {
    return a.entry.official ? -1 : 1;
  }
  const priority = (b.entry.priority ?? 0) - (a.entry.priority ?? 0);
  if (priority !== 0) return priority;
  const created =
    (Date.parse(b.entry.created ?? "") || 0) -
    (Date.parse(a.entry.created ?? "") || 0);
  if (created !== 0) return created;
  return a.entry.id.localeCompare(b.entry.id);
}

export function chooseOnboardingRootfs({
  images,
  kind,
  fallback,
  isAdmin,
}: {
  images: RootfsImageEntry[];
  kind: OnboardingProjectKind;
  fallback?: { image?: string; image_id?: string };
  isAdmin?: boolean;
}): OnboardingRootfsSelection | undefined {
  const tags = ONBOARDING_ROOTFS_TAGS[kind];
  const candidates = images
    .filter((entry) =>
      isNewProjectRootfsSelectable({ entry, isGpu: false, isAdmin }),
    )
    .map((entry) => ({ entry, rank: tagRank(entry, tags) }))
    .filter(
      (candidate): candidate is { entry: RootfsImageEntry; rank: number } =>
        candidate.rank != null,
    )
    .sort(compareCandidates);
  const preferred = candidates[0];
  if (preferred) {
    return {
      image: preferred.entry.image,
      image_id: preferred.entry.id,
      entry: preferred.entry,
      matched_tag: tags[preferred.rank],
    };
  }

  const fallbackId = `${fallback?.image_id ?? ""}`.trim();
  const fallbackImage = `${fallback?.image ?? ""}`.trim();
  const fallbackEntry = images.find(
    (entry) =>
      (fallbackId && entry.id === fallbackId) ||
      (fallbackImage && entry.image === fallbackImage),
  );
  if (
    fallbackEntry &&
    isNewProjectRootfsSelectable({
      entry: fallbackEntry,
      isGpu: false,
      isAdmin,
    })
  ) {
    return {
      image: fallbackEntry.image,
      image_id: fallbackEntry.id,
      entry: fallbackEntry,
    };
  }
  if (fallbackImage) {
    return { image: fallbackImage, image_id: fallbackId || undefined };
  }
  return undefined;
}
