import { APP_ROUTES } from "@cocalc/util/routing/app";
import type { Request } from "express";
import { sitemapLocation } from "./sitemap";

// Verify the public policy against a local hub with:
// curl -H 'Host: cocalc.ai' http://127.0.0.1:9100/robots.txt
// This is an exact host allowlist: subdomains such as dev123.cocalc.ai and
// branded deployments must not become indexable copies of the public site.
const PUBLIC_SITE_HOSTS = new Set(["cocalc.ai"]);
const INDEXABLE_APP_ROUTES = new Set(["share"]);

function normalizeHost(host?: string): string {
  return `${host ?? ""}`
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "")
    .replace(/:\d+$/, "");
}

function isPublicSite(req: Request): boolean {
  return PUBLIC_SITE_HOSTS.has(normalizeHost(req.get("host")));
}

function renderLockedDownRobots(): string {
  return ["User-agent: *", "Allow: /share", "Disallow: /", ""].join("\n");
}

function renderPublicRobots(req: Request): string {
  // These are authenticated app-shell routes. They may render HTML, but they are
  // not public landing/share content and should not compete with crawlable
  // marketing, docs, or shared-file URLs.
  const privateAppRoutes = Array.from(APP_ROUTES)
    .filter((route) => !INDEXABLE_APP_ROUTES.has(route))
    .map((route) => `Disallow: /${route}`);

  return [
    "User-agent: *",
    // Public marketing, docs, pricing, policy, language, and feature pages are
    // served at clean URLs. Let crawlers discover them normally.
    "Allow: /",
    // Shared files are intentionally public when a user creates a share link,
    // and /share is one of the few app routes that should be indexable.
    "Allow: /share",
    "Allow: /share/",
    // Public pages need hashed JS/CSS/image chunks from /static. The shell HTML
    // files themselves are blocked below: the public shell so crawlers prefer
    // the clean canonical URLs, and the authenticated app/embed shells because
    // they are thin app bootstraps, not public content.
    "Allow: /static/",
    "Disallow: /static/public.html",
    "Disallow: /static/app.html",
    "Disallow: /static/embed.html",
    // Prefix-match covers all public-viewer*.html share-viewer shells.
    "Disallow: /static/public-viewer",
    // These are implementation surfaces, not standalone public pages.
    "Disallow: /webapp/",
    "Disallow: /cdn/",
    "Disallow: /api/",
    ...privateAppRoutes,
    `Sitemap: ${sitemapLocation(req, "/sitemap.xml")}`,
    "",
  ].join("\n");
}

export default function getHandler() {
  return (req, res) => {
    res.header("Content-Type", "text/plain");
    res.header("Cache-Control", "public, max-age=3600, must-revalidate");
    if (!isPublicSite(req)) {
      // Default: disable everything except public shares.
      res.send(renderLockedDownRobots());
      return;
    }
    // Only the canonical public host may be indexed. Dev and branded instances
    // still render these pages, but their robots policy remains locked down.
    res.send(renderPublicRobots(req));
  };
}
