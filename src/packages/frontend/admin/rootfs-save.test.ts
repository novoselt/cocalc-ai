/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { RootfsAdminCatalogEntry } from "@cocalc/util/rootfs-images";

import { rootfsAdminSaveBody } from "./rootfs-save";

describe("rootfsAdminSaveBody", () => {
  it("clears lineage while preserving catalog metadata", () => {
    const entry = {
      id: "image-2",
      image: "cocalc.local/rootfs/image-2",
      label: "TeX Live",
      slug: "texlive",
      description: "LaTeX environment",
      family: "texlive",
      version: "2026.08",
      channel: "stable",
      supersedes_image_id: "image-1",
      default_jupyter_kernel: "python3",
      visibility: "public",
      tags: ["latex", "official"],
      theme: { title: "TeX Live" },
      official: true,
    } as RootfsAdminCatalogEntry;

    expect(
      rootfsAdminSaveBody(entry, { supersedes_image_id: null }),
    ).toMatchObject({
      image_id: "image-2",
      label: "TeX Live",
      slug: "texlive",
      description: "LaTeX environment",
      family: "texlive",
      version: "2026.08",
      channel: "stable",
      supersedes_image_id: null,
      default_jupyter_kernel: "python3",
      tags: ["latex", "official"],
      theme: { title: "TeX Live" },
      official: true,
    });
  });
});
