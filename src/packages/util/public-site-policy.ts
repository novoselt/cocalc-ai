import { LOCALE } from "./i18n/locale";

export const CANONICAL_PUBLIC_SITE_HOST = "cocalc.ai";
export const CANONICAL_PUBLIC_SITE_ORIGIN = `https://${CANONICAL_PUBLIC_SITE_HOST}`;

const COCALC_AI_ONLY_SECTIONS = new Set([
  "about",
  "features",
  "guides",
  "lang",
  "pricing",
  "products",
]);

export const COCALC_AI_ONLY_PATH_PREFIXES = [
  "/about",
  "/features",
  "/guides",
  "/lang",
  ...LOCALE.map((locale) => `/${locale}`),
  "/pricing",
  "/products",
];

export function normalizePublicSiteHost(host?: string): string {
  const normalized = `${host ?? ""}`
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
  const bracketedIpv6 = normalized.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracketedIpv6) return bracketedIpv6[1];
  return (normalized.match(/:/g)?.length ?? 0) <= 1
    ? normalized.replace(/:\d+$/, "")
    : normalized;
}

export function isCanonicalPublicSiteHost(host?: string): boolean {
  return normalizePublicSiteHost(host) === CANONICAL_PUBLIC_SITE_HOST;
}

export function isLockedDownPublicSiteHost(host?: string): boolean {
  const normalized = normalizePublicSiteHost(host);
  return (
    !normalized ||
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized.endsWith(`.${CANONICAL_PUBLIC_SITE_HOST}`)
  );
}

export function isCocalcAiOnlyPublicPath(path: string): boolean {
  return COCALC_AI_ONLY_PATH_PREFIXES.some(
    (prefix) => path === prefix || path.startsWith(`${prefix}/`),
  );
}

export function isCocalcAiOnlyPublicSection(section: string): boolean {
  return COCALC_AI_ONLY_SECTIONS.has(section);
}
