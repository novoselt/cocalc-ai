// Any non-absolute path is assumed to be relative to the user's home directory.
// This function converts such a path to an absolute path.

import path from "node:path";

export function abspathForPlatform(
  value: string,
  {
    home = process.env.HOME ?? "",
    platform = process.platform,
  }: { home?: string; platform?: NodeJS.Platform } = {},
): string {
  const pathApi = platform === "win32" ? path.win32 : path.posix;
  if (value.length === 0) return home;
  return pathApi.isAbsolute(value) ? value : pathApi.join(home, value);
}

export default function abspath(value: string): string {
  return abspathForPlatform(value);
}
