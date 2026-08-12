/**
 * Native per-user directories used by the CoCalc CLI.
 */
import { homedir } from "node:os";
import { chmodSync } from "node:fs";
import { join, win32 } from "node:path";

type PlatformPathOptions = {
  env?: NodeJS.ProcessEnv;
  home?: string;
  platform?: NodeJS.Platform;
};

function options({
  env = process.env,
  home = homedir(),
  platform = process.platform,
}: PlatformPathOptions = {}) {
  return { env, home, platform };
}

function pathJoin(platform: NodeJS.Platform, ...parts: string[]): string {
  return platform === "win32" ? win32.join(...parts) : join(...parts);
}

export function cocalcCliConfigDir(input?: PlatformPathOptions): string {
  const { env, home, platform } = options(input);
  if (platform === "win32") {
    const appData = `${env.APPDATA ?? ""}`.trim();
    return pathJoin(
      platform,
      appData || pathJoin(platform, home, "AppData", "Roaming"),
      "CoCalc",
    );
  }
  const xdgConfig = `${env.XDG_CONFIG_HOME ?? ""}`.trim();
  return pathJoin(
    platform,
    xdgConfig || pathJoin(platform, home, ".config"),
    "cocalc",
  );
}

export function cocalcCliDataDir(input?: PlatformPathOptions): string {
  const { env, home, platform } = options(input);
  const explicit = `${env.COCALC_CLI_DATA_DIR ?? ""}`.trim();
  if (explicit) return explicit;
  if (platform === "win32") {
    const localAppData = `${env.LOCALAPPDATA ?? ""}`.trim();
    return pathJoin(
      platform,
      localAppData || pathJoin(platform, home, "AppData", "Local"),
      "CoCalc",
      "CLI",
    );
  }
  const xdgData = `${env.XDG_DATA_HOME ?? ""}`.trim();
  return pathJoin(
    platform,
    xdgData || pathJoin(platform, home, ".local", "share"),
    "cocalc",
  );
}

export function cocalcCliCacheDir(input?: PlatformPathOptions): string {
  const { env, home, platform } = options(input);
  if (platform === "win32") {
    return pathJoin(
      platform,
      cocalcCliDataDir({ env, home, platform }),
      "cache",
    );
  }
  const xdgCache = `${env.XDG_CACHE_HOME ?? ""}`.trim();
  return pathJoin(
    platform,
    xdgCache || pathJoin(platform, home, ".cache"),
    "cocalc",
  );
}

export function applyPrivateMode(
  path: string,
  mode: number,
  platform: NodeJS.Platform = process.platform,
): void {
  if (platform === "win32") return;
  chmodSync(path, mode);
}
