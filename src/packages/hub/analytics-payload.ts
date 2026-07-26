/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const UTM_KEYS = ["source", "medium", "campaign", "term", "content"] as const;
const MAX_UTM_VALUE_LENGTH = 200;

function parseUrl(value: unknown): URL | undefined {
  if (typeof value !== "string" || value.length > 4_000) return;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return;
    return url;
  } catch {
    return;
  }
}

function normalizePublicPath(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";

  if (path === "/auth/sign-in" || path === "/auth/sign-up") {
    return path;
  }

  for (const prefix of ["/auth", "/projects", "/settings", "/share"]) {
    if (path === prefix) return path;
    if (path.startsWith(`${prefix}/`)) return `${prefix}/*`;
  }

  // These routes contain only public, curated slugs. Retaining the slug makes
  // first-touch attribution useful without recording user-controlled paths.
  for (const prefix of [
    "/about",
    "/features",
    "/policies",
    "/pricing",
    "/software",
  ]) {
    if (path === prefix) return path;
    const suffix = path.slice(prefix.length + 1);
    if (
      path.startsWith(`${prefix}/`) &&
      /^[a-z0-9][a-z0-9-]{0,79}$/i.test(suffix)
    ) {
      return path;
    }
    if (path.startsWith(`${prefix}/`)) return `${prefix}/*`;
  }

  const segments = path.split("/").filter(Boolean);
  if (segments.length === 0) return "/";

  // Unknown routes retain at most one ordinary-looking top-level segment.
  // This prevents tokens, project filenames, and identifiers from becoming
  // analytics data while still distinguishing public entry points such as /br.
  const first = segments[0];
  if (
    !/^[a-z0-9][a-z0-9-]{0,63}$/i.test(first) ||
    /^[0-9a-f-]{20,}$/i.test(first)
  ) {
    return "/*";
  }
  return segments.length === 1 ? `/${first}` : `/${first}/*`;
}

function normalizeLanding(value: unknown): string | undefined {
  const url = parseUrl(value);
  if (url == null) return;
  return `${url.origin}${normalizePublicPath(url.pathname)}`;
}

function normalizeReferrer(value: unknown): string | undefined {
  const url = parseUrl(value);
  if (url == null) return;
  // Referrer paths and queries can contain search terms, document names,
  // tokens, or other PII. The origin is enough for acquisition attribution.
  return `${url.origin}/`;
}

function normalizeUtm(value: unknown): Record<string, string> | undefined {
  if (value == null || typeof value !== "object" || Array.isArray(value)) {
    return;
  }
  const input = value as Record<string, unknown>;
  const utm: Record<string, string> = {};
  for (const key of UTM_KEYS) {
    if (typeof input[key] !== "string") continue;
    const normalized = input[key].slice(0, MAX_UTM_VALUE_LENGTH);
    if (normalized.length > 0) {
      utm[key] = normalized;
    }
  }
  return Object.keys(utm).length > 0 ? utm : undefined;
}

export function normalizeAnalyticsPostPayload(
  payload: unknown,
): Record<string, unknown> | undefined {
  if (
    payload == null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return;
  }
  const input = payload as Record<string, unknown>;
  const normalized: Record<string, unknown> = {};
  const landing = normalizeLanding(input.landing);
  const referrer = normalizeReferrer(input.referrer);
  const utm = normalizeUtm(input.utm);
  if (landing != null) normalized.landing = landing;
  if (referrer != null) normalized.referrer = referrer;
  if (utm != null) normalized.utm = utm;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}
