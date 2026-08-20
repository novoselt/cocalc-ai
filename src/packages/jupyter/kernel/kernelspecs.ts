/*
Kernel spec discovery without `jupyter-paths`, `kernelspecs`, Python, or the
`jupyter` executable.

Search order (mirrors the data dirs used by `jupyter kernelspec list`):
1) JUPYTER_PATH (path-delimited list)
2) Environment and user data dirs, ordered by JUPYTER_PREFER_ENV_PATH:
   - user: JUPYTER_DATA_DIR or the current platform/XDG default
   - environment: sys-prefix/share/jupyter
3) sys-prefix is:
   - CONDA_PREFIX or VIRTUAL_ENV when set
   - otherwise the prefix of the first python/python3 on PATH
4) system dirs:
   - Linux/macOS: /usr/local/share/jupyter, /usr/share/jupyter
   - Windows: %PROGRAMDATA%\\jupyter only with JUPYTER_USE_PROGRAMDATA

This is deliberately Python-free. Results can still differ from a Python
installation when Python contributes an implicit version-specific userbase;
an explicit PYTHONUSERBASE is supported.
*/

import { accessSync, constants, realpathSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";

type KernelResources = {
  name: string;
  files: string[];
  resource_dir: string;
  spec: any;
};

export interface JupyterPathOptions {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  home?: string;
}

function environmentFlag(value: string | undefined): boolean {
  if (value === undefined) return false;
  return !new Set(["", "0", "0.0", "false", "n", "no", "off"]).has(
    value.trim().toLowerCase(),
  );
}

function pathsForPlatform(platform: NodeJS.Platform) {
  return platform === "win32" ? path.win32 : path.posix;
}

function splitEnvPaths(
  value: string | undefined,
  platform: NodeJS.Platform,
): string[] {
  if (!value) return [];
  const delimiter = platform === "win32" ? ";" : ":";
  return value.split(delimiter).filter((entry) => entry.trim() !== "");
}

function isExecutable(filePath: string): boolean {
  try {
    accessSync(filePath, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function guessSysPrefix(
  options: JupyterPathOptions = {},
): string | null {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const paths = pathsForPlatform(platform);
  const envPrefix = env.CONDA_PREFIX ?? env.VIRTUAL_ENV;
  if (envPrefix) return paths.resolve(envPrefix);

  const searchPath = splitEnvPaths(env.PATH, platform);
  if (searchPath.length === 0) return null;

  const pythonNames = platform === "win32" ? ["python"] : ["python3", "python"];
  const pathext =
    platform === "win32" ? splitEnvPaths(env.PATHEXT, platform) : [""];
  if (pathext.length === 0) pathext.push("");

  for (const bin of searchPath) {
    const resolvedBin = paths.resolve(bin);
    for (const pythonName of pythonNames) {
      const base = paths.join(resolvedBin, pythonName);
      for (const ext of pathext) {
        const exe = base + ext;
        if (isExecutable(exe)) {
          const resolvedExecutable = realpathSync(exe);
          return platform === "win32"
            ? paths.dirname(resolvedExecutable)
            : paths.dirname(paths.dirname(resolvedExecutable));
        }
      }
    }
  }
  return null;
}

export function userDataDir(options: JupyterPathOptions = {}): string {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const paths = pathsForPlatform(platform);
  if (env.JUPYTER_DATA_DIR) return paths.resolve(env.JUPYTER_DATA_DIR);

  const usePlatformDirs = environmentFlag(env.JUPYTER_PLATFORM_DIRS);
  if (platform === "darwin") {
    if (usePlatformDirs) {
      return env.XDG_DATA_HOME
        ? paths.join(env.XDG_DATA_HOME, "jupyter")
        : paths.join(home, "Library", "Application Support", "jupyter");
    }
    return paths.join(home, "Library", "Jupyter");
  }
  if (platform === "win32") {
    if (usePlatformDirs) {
      return paths.join(
        env.LOCALAPPDATA ?? paths.join(home, "AppData", "Local"),
        "jupyter",
      );
    }
    if (env.APPDATA) return paths.join(env.APPDATA, "jupyter");
    return paths.join(
      env.JUPYTER_CONFIG_DIR ?? paths.join(home, ".jupyter"),
      "data",
    );
  }
  return paths.join(
    env.XDG_DATA_HOME ?? paths.join(home, ".local", "share"),
    "jupyter",
  );
}

function systemDataDirs(options: JupyterPathOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const paths = pathsForPlatform(platform);
  if (platform === "win32") {
    if (!environmentFlag(env.JUPYTER_USE_PROGRAMDATA) || !env.PROGRAMDATA) {
      return [];
    }
    return [paths.resolve(paths.join(env.PROGRAMDATA, "jupyter"))];
  }
  return ["/usr/local/share/jupyter", "/usr/share/jupyter"];
}

function preferEnvironmentPath(options: JupyterPathOptions): boolean {
  const env = options.env ?? process.env;
  if (env.JUPYTER_PREFER_ENV_PATH !== undefined) {
    return environmentFlag(env.JUPYTER_PREFER_ENV_PATH);
  }
  if (env.VIRTUAL_ENV) return true;
  return Boolean(
    env.CONDA_PREFIX && (env.CONDA_DEFAULT_ENV ?? "base") !== "base",
  );
}

export function getJupyterDataDirs(options: JupyterPathOptions = {}): string[] {
  const platform = options.platform ?? process.platform;
  const env = options.env ?? process.env;
  const paths = pathsForPlatform(platform);
  const dirs = splitEnvPaths(env.JUPYTER_PATH, platform);
  const user = [userDataDir(options)];
  if (env.PYTHONUSERBASE) {
    user.push(
      paths.join(paths.resolve(env.PYTHONUSERBASE), "share", "jupyter"),
    );
  }
  const sysPrefix = guessSysPrefix(options);
  const environment = sysPrefix
    ? [paths.join(sysPrefix, "share", "jupyter")]
    : [];
  const preferEnvironment = preferEnvironmentPath(options);
  dirs.push(
    ...(preferEnvironment ? environment : user),
    ...(preferEnvironment ? user : environment),
    ...systemDataDirs(options),
  );

  const seen = new Set<string>();
  return dirs.filter((dir) => {
    const resolved = paths.resolve(dir);
    if (seen.has(resolved)) return false;
    seen.add(resolved);
    return true;
  });
}

async function getKernelResources(kernelInfo: {
  name: string;
  resourceDir: string;
}): Promise<KernelResources | undefined> {
  try {
    const files = await readdir(kernelInfo.resourceDir);
    if (!files.includes("kernel.json")) return undefined;
    const data = await readFile(
      path.join(kernelInfo.resourceDir, "kernel.json"),
    );
    return {
      name: kernelInfo.name,
      files: files.map((entry) => path.join(kernelInfo.resourceDir, entry)),
      resource_dir: kernelInfo.resourceDir,
      spec: JSON.parse(data.toString()),
    };
  } catch {
    return undefined;
  }
}

async function getKernelInfos(directory: string) {
  try {
    const entries = await readdir(directory, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        name: entry.name,
        resourceDir: path.join(directory, entry.name),
      }));
  } catch {
    return [];
  }
}

export async function findAllKernelSpecs(
  options: JupyterPathOptions = {},
): Promise<Record<string, KernelResources>> {
  const dataDirs = getJupyterDataDirs(options);
  const kernelDirs = dataDirs.map((dir) => path.join(dir, "kernels"));
  const kernelInfos = (
    await Promise.all(kernelDirs.map((dir) => getKernelInfos(dir)))
  ).flat();
  const kernelResources = await Promise.all(
    kernelInfos.map((info) => getKernelResources(info)),
  );
  return kernelResources.reduce<Record<string, KernelResources>>(
    (kernels, kernel) => {
      if (kernel && !kernels[kernel.name]) kernels[kernel.name] = kernel;
      return kernels;
    },
    {},
  );
}

export async function findKernelSpec(
  name: string,
  options: JupyterPathOptions = {},
): Promise<KernelResources> {
  const specs = await findAllKernelSpecs(options);
  const spec = specs[name];
  if (!spec) {
    throw new Error(
      `No spec available for kernel "${name}".  Available specs: ${JSON.stringify(
        Object.keys(specs),
      )}`,
    );
  }
  return spec;
}
