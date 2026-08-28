/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export type AdminSection =
  | "active-users"
  | "admin-data-explorer"
  | "admin-purchase"
  | "bay-ops"
  | "codex-pools"
  | "customers"
  | "managed-cpu"
  | "managed-egress"
  | "revenue-analytics"
  | "membership-tiers"
  | "project-backup-shards"
  | "receivables"
  | "retention"
  | "registration-tokens"
  | "rootfs"
  | "site-setup"
  | "site-license-claims"
  | "site-licenses"
  | "site-settings"
  | "software-licenses"
  | "sso"
  | "usage-stats"
  | "user-search";

const ADMIN_SECTIONS = new Set<AdminSection>([
  "active-users",
  "admin-data-explorer",
  "admin-purchase",
  "bay-ops",
  "codex-pools",
  "customers",
  "managed-cpu",
  "managed-egress",
  "revenue-analytics",
  "membership-tiers",
  "project-backup-shards",
  "receivables",
  "retention",
  "registration-tokens",
  "rootfs",
  "site-setup",
  "site-license-claims",
  "site-licenses",
  "site-settings",
  "software-licenses",
  "sso",
  "usage-stats",
  "user-search",
]);

export type AdminRoute =
  | { kind: "index"; section?: AdminSection }
  | { kind: "customer-detail"; id: string }
  | { kind: "receivables-create" }
  | { kind: "receivables-detail"; id: string }
  | { kind: "site-license-detail"; id: string }
  | { kind: "news-list" }
  | { kind: "news-editor"; id: string };

type AdminRouteLike =
  | AdminRoute
  | {
      get?: (key: string) => unknown;
      toJS?: () => unknown;
    }
  | null
  | undefined;

export function parseAdminRoute(
  input: string | readonly string[],
): AdminRoute | undefined {
  const rawSegments =
    typeof input === "string" ? input.split("/") : Array.from(input);
  const segments = rawSegments.filter(Boolean);
  if (segments[0] === "admin") {
    segments.shift();
  }
  const [section, id] = segments;

  switch (section) {
    case undefined:
    case "":
      return { kind: "index" };
    case "news":
      if (!id) {
        return { kind: "news-list" };
      }
      return { kind: "news-editor", id };
    case "receivables":
      if (!id) {
        return { kind: "index", section: "receivables" };
      }
      if (id === "new") {
        return { kind: "receivables-create" };
      }
      return { kind: "receivables-detail", id };
    case "customers":
      if (!id) {
        return { kind: "index", section: "customers" };
      }
      return { kind: "customer-detail", id };
    case "site-licenses":
      if (!id) {
        return { kind: "index", section: "site-licenses" };
      }
      return { kind: "site-license-detail", id };
    default:
      if (ADMIN_SECTIONS.has(section as AdminSection) && id == null) {
        return { kind: "index", section: section as AdminSection };
      }
      return undefined;
  }
}

export function normalizeAdminRoute(route: AdminRouteLike): AdminRoute {
  if (route == null) {
    return { kind: "index" };
  }
  let normalized: unknown = route;
  const routeObject = route as {
    get?: (key: string) => unknown;
    toJS?: () => unknown;
  };
  if (typeof routeObject.toJS === "function") {
    normalized = routeObject.toJS();
  } else if (typeof routeObject.get === "function") {
    normalized = {
      kind: routeObject.get("kind"),
      id: routeObject.get("id"),
    };
  }

  switch (normalized?.["kind"]) {
    case "news-list":
      return { kind: "news-list" };
    case "news-editor": {
      const id = normalized?.["id"];
      if (typeof id === "string" && id) {
        return { kind: "news-editor", id };
      }
      return { kind: "news-list" };
    }
    case "receivables-detail": {
      const id = normalized?.["id"];
      if (typeof id === "string" && id) {
        return { kind: "receivables-detail", id };
      }
      return { kind: "index", section: "receivables" };
    }
    case "customer-detail": {
      const id = normalized?.["id"];
      if (typeof id === "string" && id) {
        return { kind: "customer-detail", id };
      }
      return { kind: "index", section: "customers" };
    }
    case "site-license-detail": {
      const id = normalized?.["id"];
      if (typeof id === "string" && id) {
        return { kind: "site-license-detail", id };
      }
      return { kind: "index", section: "site-licenses" };
    }
    case "receivables-create":
      return { kind: "receivables-create" };
    case "index":
      return normalizeAdminSection(normalized?.["section"]);
    default:
      return { kind: "index" };
  }
}

function normalizeAdminSection(
  section: unknown,
): Extract<AdminRoute, { kind: "index" }> {
  if (
    typeof section === "string" &&
    ADMIN_SECTIONS.has(section as AdminSection)
  ) {
    return { kind: "index", section: section as AdminSection };
  }
  return { kind: "index" };
}

export function getAdminTargetPath(route: AdminRouteLike): string {
  const normalized = normalizeAdminRoute(route);
  switch (normalized.kind) {
    case "index":
      return normalized.section ? `admin/${normalized.section}` : "admin";
    case "news-list":
      return "admin/news";
    case "news-editor":
      return `admin/news/${normalized.id}`;
    case "receivables-detail":
      return `admin/receivables/${encodeURIComponent(normalized.id)}`;
    case "receivables-create":
      return "admin/receivables/new";
    case "customer-detail":
      return `admin/customers/${encodeURIComponent(normalized.id)}`;
    case "site-license-detail":
      return `admin/site-licenses/${encodeURIComponent(normalized.id)}`;
  }
}

export function getAdminUrlPath(route: AdminRouteLike): string {
  return `/${getAdminTargetPath(route)}`;
}
