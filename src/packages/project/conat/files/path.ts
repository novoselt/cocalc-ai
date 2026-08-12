/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import path from "node:path";

export function projectFilePath(
  requestedPath: string,
  {
    home = process.env.HOME,
    platform = process.platform,
  }: { home?: string; platform?: NodeJS.Platform } = {},
): string {
  if (!home) return requestedPath;
  if (platform !== "win32") {
    return path.isAbsolute(requestedPath)
      ? requestedPath
      : path.join(home, requestedPath);
  }

  if (
    /^[A-Za-z]:[\\/]/.test(requestedPath) ||
    requestedPath.startsWith("\\\\")
  ) {
    return path.win32.normalize(requestedPath);
  }
  const virtualPath = requestedPath.replaceAll("\\", "/");
  const homePrefix = "/home/user";
  const relative = path.posix
    .resolve(
      "/",
      virtualPath === homePrefix
        ? ""
        : virtualPath.startsWith(`${homePrefix}/`)
          ? virtualPath.slice(homePrefix.length + 1)
          : virtualPath,
    )
    .slice(1);
  return path.win32.join(home, ...relative.split("/").filter(Boolean));
}
