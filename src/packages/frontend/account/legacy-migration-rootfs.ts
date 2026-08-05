/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { RootfsImageEntry } from "@cocalc/util/rootfs-images";

export function firstLegacyMigrationRootfs(
  images: RootfsImageEntry[],
): RootfsImageEntry | undefined {
  return images.find((entry) =>
    entry.tags?.some((tag) => tag.trim().toLowerCase() === "legacy"),
  );
}
