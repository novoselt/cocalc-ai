/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { URL } from "node:url";
import type { IncomingMessage } from "node:http";
import TTL from "@isaacs/ttlcache";
import { isValidUUID } from "@cocalc/util/misc";

export const PRIVATE_APP_HOST_HEADER = "x-cocalc-private-app-host";

export interface PrivateAppHostnameRoute {
  project_id: string;
  app_id: string;
  base_path: string;
}

export interface PrivateAppHostnameTrace {
  matched: boolean;
  project_id?: string;
  app_id?: string;
  base_path?: string;
}

function normalizePrefix(value: string): string {
  const withLeading = value.startsWith("/") ? value : `/${value}`;
  return withLeading.replace(/\/+$/, "") || "/";
}

function normalizeHostHeader(value: unknown): string {
  return `${value ?? ""}`.trim().toLowerCase().split(":")[0] ?? "";
}

export function rewritePrivateAppHostnameUrl({
  originalUrl,
  route,
}: {
  originalUrl?: string;
  route: PrivateAppHostnameRoute;
}): string {
  const parsed = new URL(originalUrl ?? "/", "http://project-host.local");
  const incomingPath = parsed.pathname || "/";
  const canonicalBasePath = normalizePrefix(
    `/${route.project_id}${route.base_path}`,
  );
  const proxiedPath =
    incomingPath === canonicalBasePath ||
    incomingPath.startsWith(`${canonicalBasePath}/`)
      ? incomingPath
      : normalizePrefix(
          `${canonicalBasePath}${incomingPath === "/" ? "" : incomingPath}`,
        );
  return `${proxiedPath}${parsed.search ?? ""}`;
}

export function createPrivateAppHostnameRequestRewriter({
  trace,
  cacheMs = 30_000,
  onTraceError,
}: {
  trace: (hostname: string) => Promise<PrivateAppHostnameTrace | undefined>;
  cacheMs?: number;
  onTraceError?: (hostname: string, err: unknown) => void;
}): (req: IncomingMessage) => Promise<void> {
  const routeCache = new TTL<string, PrivateAppHostnameRoute | null>({
    max: 20_000,
    ttl: Math.max(1_000, cacheMs),
  });

  return async (req: IncomingMessage): Promise<void> => {
    const currentUrl = `${req.url ?? ""}`;
    if (!currentUrl) return;
    const parsed = new URL(currentUrl, "http://project-host.local");
    const maybeProjectPrefix = (parsed.pathname || "/").split("/")[1];
    if (maybeProjectPrefix && isValidUUID(maybeProjectPrefix)) return;

    const hostname = normalizeHostHeader(req.headers.host);
    if (!hostname) return;
    let route = routeCache.get(hostname);
    if (route === undefined) {
      try {
        const traced = await trace(hostname);
        route =
          traced?.matched &&
          traced.project_id &&
          traced.app_id &&
          traced.base_path
            ? {
                project_id: traced.project_id,
                app_id: traced.app_id,
                base_path: normalizePrefix(traced.base_path),
              }
            : null;
      } catch (err) {
        onTraceError?.(hostname, err);
        route = null;
      }
      routeCache.set(hostname, route);
    }
    if (!route) return;

    req.url = rewritePrivateAppHostnameUrl({
      originalUrl: currentUrl,
      route,
    });
    req.headers[PRIVATE_APP_HOST_HEADER] = hostname;
  };
}
