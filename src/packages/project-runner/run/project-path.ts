import { lstatSync, readlinkSync } from "node:fs";
import { isAbsolute, join, normalize, relative } from "node:path";

const PROJECT_CONTAINER_HOME = "/home/user";

function isPathInside(base: string, path: string): boolean {
  const rel = relative(base, path);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function hostPathForProjectPath(home: string, path: string): string {
  const local = join(home, ".local");
  if (!isPathInside(local, path)) {
    return path;
  }

  let target: string;
  try {
    const info = lstatSync(local);
    if (!info.isSymbolicLink()) {
      return path;
    }
    target = readlinkSync(local);
  } catch {
    return path;
  }

  if (!isAbsolute(target)) {
    return path;
  }

  const targetRelativeToContainerHome = relative(
    PROJECT_CONTAINER_HOME,
    normalize(target),
  );
  if (
    targetRelativeToContainerHome.startsWith("..") ||
    isAbsolute(targetRelativeToContainerHome)
  ) {
    return path;
  }

  // Legacy projects may have .local -> /home/user/... inside the container.
  // Resolve that to the equivalent project path for host-side setup.
  return join(home, targetRelativeToContainerHome, relative(local, path));
}
