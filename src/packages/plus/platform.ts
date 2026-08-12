/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface PlusRuntimePaths {
  root: string;
  data: string;
  workspace: string;
}

export function plusRuntimePaths({
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
}: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  home?: string;
} = {}): PlusRuntimePaths {
  if (platform === "win32") {
    const windowsPath = path.win32;
    const profile = env.USERPROFILE?.trim() || home;
    const localAppData =
      env.LOCALAPPDATA?.trim() || windowsPath.join(profile, "AppData", "Local");
    const root =
      env.COCALC_PLUS_HOME?.trim() ||
      windowsPath.join(localAppData, "CoCalc", "Plus");
    return {
      root,
      data: env.COCALC_DATA_DIR?.trim() || windowsPath.join(root, "data"),
      workspace:
        env.COCALC_PLUS_WORKSPACE?.trim() ||
        windowsPath.join(profile, "CoCalc"),
    };
  }

  const root =
    env.COCALC_PLUS_HOME?.trim() ||
    (platform === "darwin"
      ? path.join(home, "Library", "Application Support", "cocalc-plus")
      : path.join(home, ".local", "share", "cocalc-plus"));
  return {
    root,
    data: env.COCALC_DATA_DIR?.trim() || path.join(root, "data"),
    workspace: env.COCALC_PLUS_WORKSPACE?.trim() || home,
  };
}

export function configurePlusRuntime(
  env: NodeJS.ProcessEnv = process.env,
): PlusRuntimePaths {
  const paths = plusRuntimePaths({ env });
  for (const directory of [paths.root, paths.data, paths.workspace]) {
    fs.mkdirSync(directory, { recursive: true });
  }
  env.COCALC_PLUS_HOME = paths.root;
  env.COCALC_PLUS_WORKSPACE = paths.workspace;
  env.COCALC_DATA_DIR = paths.data;
  env.DATA = paths.data;

  if (process.platform === "win32") {
    // Lite treats HOME as the visible one-project filesystem root.
    env.HOME = paths.workspace;
    env.COCALC_RUNTIME_HOME = "/home/user";
    env.COCALC_ENABLE_PROJECT_INFO = "0";
    env.COCALC_WINDOWS_TERMINAL_SHELL ??= "powershell.exe";
  }
  return paths;
}
