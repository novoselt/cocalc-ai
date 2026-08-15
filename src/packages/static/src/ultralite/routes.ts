/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

export type UltraliteRoute =
  | { kind: "projects" }
  | { kind: "project"; projectId: string }
  | { kind: "files"; projectId: string; path: string }
  | { kind: "file"; projectId: string; path: string }
  | { kind: "agents"; projectId: string }
  | {
      kind: "chat";
      projectId: string;
      chatPath: string;
      threadId: string;
    };

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizeProjectPath(value?: string): string {
  const parts = `${value || "/home/user"}`
    .replace(/\\/g, "/")
    .split("/")
    .filter(Boolean);
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === ".") continue;
    if (part === "..") normalized.pop();
    else if (!part.includes("\0")) normalized.push(part);
  }
  const path = `/${normalized.join("/")}`;
  return path === "/home/user" || path.startsWith("/home/user/")
    ? path
    : "/home/user";
}

export function parseRoute(hash = window.location.hash): UltraliteRoute {
  const raw = hash.replace(/^#\/?/, "");
  const [pathname, query = ""] = raw.split("?", 2);
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "project" || !UUID.test(segments[1] ?? "")) {
    return { kind: "projects" };
  }
  const projectId = segments[1];
  const params = new URLSearchParams(query);
  switch (segments[2]) {
    case "files":
      return {
        kind: "files",
        projectId,
        path: normalizeProjectPath(params.get("path") ?? undefined),
      };
    case "file":
      return {
        kind: "file",
        projectId,
        path: normalizeProjectPath(params.get("path") ?? undefined),
      };
    case "agents":
      return { kind: "agents", projectId };
    case "chat": {
      const chatPath = normalizeProjectPath(params.get("path") ?? undefined);
      const threadId = params.get("thread")?.trim();
      return threadId
        ? { kind: "chat", projectId, chatPath, threadId }
        : { kind: "agents", projectId };
    }
    default:
      return { kind: "project", projectId };
  }
}

export function routeHash(route: UltraliteRoute): string {
  if (route.kind === "projects") return "#/projects";
  const root = `#/project/${route.projectId}`;
  switch (route.kind) {
    case "project":
      return root;
    case "files":
      return `${root}/files?${new URLSearchParams({ path: route.path })}`;
    case "file":
      return `${root}/file?${new URLSearchParams({ path: route.path })}`;
    case "agents":
      return `${root}/agents`;
    case "chat":
      return `${root}/chat?${new URLSearchParams({
        path: route.chatPath,
        thread: route.threadId,
      })}`;
  }
}

export function navigate(route: UltraliteRoute): void {
  window.location.hash = routeHash(route);
}
