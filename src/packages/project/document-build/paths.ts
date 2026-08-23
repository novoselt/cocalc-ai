/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import path from "node:path";
import {
  DEFAULT_PROJECT_RUNTIME_HOME,
  PROJECT_RUNTIME_HOME_ALIASES,
  projectRuntimePathForProcess,
} from "@cocalc/util/project-runtime";

export function normalizeDocumentPath(
  rawPath: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  if (typeof rawPath !== "string" || !rawPath.trim()) {
    throw new Error("document build path must be nonempty");
  }
  const runtimeHome = path.posix.resolve(
    env.COCALC_RUNTIME_HOME || DEFAULT_PROJECT_RUNTIME_HOME,
  );
  const input = rawPath.trim().replace(/\\/g, "/");
  let relative: string;
  if (path.posix.isAbsolute(input)) {
    const normalized = path.posix.resolve(input);
    const home = PROJECT_RUNTIME_HOME_ALIASES.find(
      (candidate) =>
        normalized === candidate || normalized.startsWith(`${candidate}/`),
    );
    if (home == null) {
      throw new Error(`document build path must be inside ${runtimeHome}`);
    }
    relative = path.posix.relative(home, normalized);
  } else {
    relative = path.posix.normalize(input);
    if (
      relative === ".." ||
      relative.startsWith("../") ||
      path.posix.isAbsolute(relative)
    ) {
      throw new Error(`document build path must be inside ${runtimeHome}`);
    }
  }
  if (!relative || relative === ".") {
    throw new Error("document build path must identify a file");
  }
  return path.posix.join(runtimeHome, relative);
}

export function documentProcessPath(
  projectPath: string,
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const normalized = normalizeDocumentPath(projectPath, env);
  const processPath = projectRuntimePathForProcess(normalized, env);
  if (processPath == null) throw new Error("unable to resolve document path");
  const home = path.resolve(env.HOME || DEFAULT_PROJECT_RUNTIME_HOME);
  const resolved = path.resolve(processPath);
  const relative = path.relative(home, resolved);
  if (
    relative === ".." ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new Error(`document build path must be inside ${home}`);
  }
  return resolved;
}
