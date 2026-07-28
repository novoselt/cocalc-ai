/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export type ProjectFixedRouteTab =
  | "agents"
  | "docs"
  | "info"
  | "log"
  | "rootfs"
  | "servers"
  | "settings"
  | "users"
  | "workspaces";

export type ParsedProjectTarget =
  | { kind: "directory"; path: string }
  | { kind: "file"; path: string; parentPath: string }
  | { kind: "new"; path: string }
  | { kind: "search"; path: string }
  | { kind: "tab"; tab: ProjectFixedRouteTab }
  | { kind: "app"; path: string }
  | { kind: "private-app"; appId: string };

export type PrivateProjectAppHandoffTarget = {
  projectId: string;
  appId: string;
};

type PathEncoder = {
  encodeRelativePath: (path: string) => string;
};

type TargetEncoder = {
  encodeProjectTarget: (target: string) => string;
};

type PathDecoder = {
  decodeDirectoryPath: (path: string) => string;
};

export function buildProjectFilesTarget(
  path: string,
  isDirectory: boolean,
  opts: PathEncoder,
): string {
  const relativePath = opts.encodeRelativePath(path);
  if (relativePath.length === 0) {
    return "files/";
  }
  return `files/${relativePath}${isDirectory ? "/" : ""}`;
}

export function buildProjectScopedTarget(
  tab: "new" | "search",
  path: string,
  opts: PathEncoder,
): string {
  const relativePath = opts.encodeRelativePath(path);
  return relativePath.length === 0 ? `${tab}/` : `${tab}/${relativePath}`;
}

export function getProjectTargetPath(
  projectId: string,
  localTarget: string | undefined,
  opts?: TargetEncoder,
): string {
  if (!localTarget) {
    return `projects/${projectId}`;
  }
  const encodeProjectTarget = opts?.encodeProjectTarget ?? ((target) => target);
  return `projects/${projectId}/${encodeProjectTarget(localTarget)}`;
}

export function getProjectUrlPath(
  projectId: string,
  localTarget: string | undefined,
  opts?: TargetEncoder,
): string {
  return `/${getProjectTargetPath(projectId, localTarget, opts)}`;
}

export function parseProjectTarget(
  target: string,
  opts: PathDecoder,
): ParsedProjectTarget | undefined {
  const segments = target.split("/");
  const mainSegment = segments[0];
  const hasScopedPathSource =
    (mainSegment === "new" || mainSegment === "search") &&
    segments[1] === "files";
  const scopedPathIndex = hasScopedPathSource ? 2 : 1;

  switch (mainSegment) {
    case "files": {
      if (target === "files" || target === "files/") {
        return { kind: "directory", path: opts.decodeDirectoryPath("") };
      }
      const fullPath = opts.decodeDirectoryPath(segments.slice(1).join("/"));
      const parentPath = opts.decodeDirectoryPath(
        segments.slice(1, segments.length - 1).join("/"),
      );
      if (target.endsWith("/")) {
        return { kind: "directory", path: parentPath };
      }
      return { kind: "file", path: fullPath, parentPath };
    }

    case "new":
      return {
        kind: "new",
        path: opts.decodeDirectoryPath(
          segments.slice(scopedPathIndex).join("/"),
        ),
      };

    case "search":
      return {
        kind: "search",
        path: opts.decodeDirectoryPath(
          segments.slice(scopedPathIndex).join("/"),
        ),
      };

    case "project-home":
      return { kind: "directory", path: opts.decodeDirectoryPath("") };

    case "agents":
    case "docs":
    case "info":
    case "log":
    case "rootfs":
    case "servers":
    case "settings":
    case "users":
    case "workspaces":
      return { kind: "tab", tab: mainSegment };

    case "apps":
      return {
        kind: "app",
        path: segments.slice(1).join("/"),
      };

    case "private-app": {
      const encoded = segments.slice(1).join("/");
      if (!encoded) return undefined;
      try {
        return { kind: "private-app", appId: decodeURIComponent(encoded) };
      } catch {
        return undefined;
      }
    }

    default:
      return undefined;
  }
}

export function parsePrivateProjectAppHandoffTarget(
  target: string,
): PrivateProjectAppHandoffTarget | undefined {
  const separator = target.indexOf("/");
  if (separator <= 0) return;
  const projectId = target.slice(0, separator);
  const route = parseProjectTarget(target.slice(separator + 1), {
    decodeDirectoryPath: (path) => path,
  });
  if (route?.kind !== "private-app") return;
  return { projectId, appId: route.appId };
}
