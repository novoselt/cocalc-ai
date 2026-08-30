/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  RootfsAdminCatalogEntry,
  RootfsCatalogSaveBody,
} from "@cocalc/util/rootfs-images";

export type RootfsAdminCatalogPatch = Partial<
  Omit<RootfsAdminCatalogEntry, "supersedes_image_id">
> & {
  supersedes_image_id?: string | null;
};

export async function runRootfsAdminSaveAction({
  runFreshAuthAction,
  save,
}: {
  runFreshAuthAction: (action: () => Promise<void>) => Promise<boolean>;
  save: () => Promise<void>;
}): Promise<boolean> {
  return await runFreshAuthAction(save);
}

export function rootfsAdminSaveBody(
  entry: RootfsAdminCatalogEntry,
  patch: RootfsAdminCatalogPatch,
): RootfsCatalogSaveBody {
  const next = { ...entry, ...patch };
  return {
    image_id: entry.id,
    slug: next.slug,
    image: next.image,
    label: next.label,
    family: next.family,
    version: next.version,
    channel: next.channel,
    supersedes_image_id: next.supersedes_image_id,
    description: next.description,
    default_jupyter_kernel: next.default_jupyter_kernel,
    visibility: next.visibility,
    arch: next.arch,
    gpu: next.gpu,
    size_gb: next.size_gb,
    tags: next.tags,
    theme: next.theme,
    content: next.content,
    content_warnings: next.content_warnings,
    official: next.official,
    prepull: next.prepull,
    hidden: next.hidden,
    blocked: next.blocked,
    blocked_reason: next.blocked_reason,
  };
}
