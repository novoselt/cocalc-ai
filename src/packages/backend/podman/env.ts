import { accessSync, constants, statSync } from "node:fs";

const DEFAULT_CONTAINER_RUNTIME_CURRENT =
  "/opt/cocalc/container-runtime/current";

function isExecutable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function configuredContainerRuntimeCurrent(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const configured = `${
    env.COCALC_CONTAINER_RUNTIME_CURRENT ?? DEFAULT_CONTAINER_RUNTIME_CURRENT
  }`.trim();
  return configured && isExecutable(`${configured}/bin/podman`)
    ? configured
    : undefined;
}

function isUsableDir(dir: string): boolean {
  try {
    const stat = statSync(dir);
    if (!stat.isDirectory()) return false;
    accessSync(dir, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export function podmanEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const env = { ...baseEnv };
  const runtimeCurrent = configuredContainerRuntimeCurrent(env);
  if (runtimeCurrent) {
    const bin = `${runtimeCurrent}/bin`;
    env.PATH = `${bin}:${env.PATH ?? "/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"}`;
    env.CONTAINERS_CONF ??= `${runtimeCurrent}/etc/containers/containers.conf`;
    env.COCALC_PODMAN_BIN ??= `${bin}/podman`;
  }
  const uid =
    typeof process.getuid === "function" ? process.getuid() : undefined;
  const configured = env.COCALC_PODMAN_RUNTIME_DIR || env.XDG_RUNTIME_DIR;
  const userRun =
    typeof uid === "number" ? `/run/user/${uid.toString()}` : undefined;
  // Podman (especially with crun) expects XDG_RUNTIME_DIR to exist and be writable.
  // On fresh boot, /run/user/<uid> only appears after a user login session, so we
  // rely on systemd linger to ensure it exists, otherwise we fail loudly.
  let runtimeDir =
    configured && isUsableDir(configured) ? configured : undefined;
  if (!runtimeDir && userRun && isUsableDir(userRun)) {
    runtimeDir = userRun;
  }
  if (!runtimeDir) {
    const userHint = env.USER || env.LOGNAME || "the project-host user";
    throw new Error(
      `podman requires XDG_RUNTIME_DIR (expected ${userRun ?? "a user runtime dir"}). ` +
        `Enable linger for ${userHint} (loginctl enable-linger ${userHint}) ` +
        `or set COCALC_PODMAN_RUNTIME_DIR to a writable runtime dir.`,
    );
  }
  env.XDG_RUNTIME_DIR = runtimeDir;
  if (!env.CONTAINERS_CGROUP_MANAGER) {
    env.CONTAINERS_CGROUP_MANAGER = "cgroupfs";
  }
  return env;
}
