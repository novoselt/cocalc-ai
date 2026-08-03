/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { PROJECT_HOST_BROWSER_SESSION_COOKIE_NAME } from "./project-host-browser-session";
import {
  PROJECT_HOST_HTTP_AUTH_COOKIE_NAME,
  PROJECT_HOST_HTTP_SESSION_COOKIE_NAME,
} from "./project-host-http";

const PROJECT_HOST_EDGE_AUTH_COOKIE_NAMES = new Set([
  PROJECT_HOST_HTTP_AUTH_COOKIE_NAME,
  PROJECT_HOST_HTTP_SESSION_COOKIE_NAME,
  PROJECT_HOST_BROWSER_SESSION_COOKIE_NAME,
]);

export function stripProjectHostProxyAuthCookies(
  cookieHeader: string | string[] | undefined,
  {
    preserveCookieNames = [],
  }: {
    preserveCookieNames?: string[];
  } = {},
): string | undefined {
  if (cookieHeader == null) return undefined;
  const preserved = new Set(preserveCookieNames);
  const raw = Array.isArray(cookieHeader)
    ? cookieHeader.join(";")
    : cookieHeader;
  const kept = raw
    .split(";")
    .map((part) => part.trim())
    .filter(Boolean)
    .filter((part) => {
      const idx = part.indexOf("=");
      const name = idx === -1 ? part : part.slice(0, idx).trim();
      return (
        !PROJECT_HOST_EDGE_AUTH_COOKIE_NAMES.has(name) || preserved.has(name)
      );
    });
  return kept.length > 0 ? kept.join("; ") : undefined;
}
