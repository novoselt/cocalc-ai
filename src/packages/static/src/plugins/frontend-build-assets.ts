/*
 *  This file is part of CoCalc: Copyright (C) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export function isContentAddressedFrontendAsset(name: string): boolean {
  const normalized = `${name ?? ""}`.replace(/\\/g, "/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..")
  ) {
    return false;
  }
  const basename = normalized.slice(normalized.lastIndexOf("/") + 1);
  return /(?:^|[-.])[0-9a-f]{16,}(?=[-.]|$)/i.test(basename);
}

export function frontendManifestAssets(compilation: {
  getAssets: () => { name: string }[];
}): string[] {
  return compilation
    .getAssets()
    .map(({ name }) => name)
    .filter(isContentAddressedFrontendAsset)
    .sort();
}
