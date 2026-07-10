import { get_server_settings } from "@cocalc/database/postgres/settings/server-settings";
import { getLogger } from "@cocalc/hub/logger";
import { APP_ROUTES } from "@cocalc/util/routing/app";
import type { Request } from "express";
import { sitemapLocation } from "./sitemap";

const logger = getLogger("hub:servers:robots");
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

function isPublicSite(req: Request, settings): boolean {
  return (
    !!settings.landing_pages ||
    PUBLIC_SITE_HOSTS.has(normalizeHost(req.get("host"))) ||
    PUBLIC_SITE_HOSTS.has(normalizeHost(settings.dns))
  );
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
  return async (req, res) => {
    try {
      const settings = await get_server_settings(); // don't worry -- this is cached.
      res.header("Content-Type", "text/plain");
      res.header("Cache-Control", "public, max-age=3600, must-revalidate");
      if (!isPublicSite(req, settings)) {
        // Default: disable everything except public shares.
        res.write(renderLockedDownRobots());
      } else {
        // Hosted CoCalc serves public pages at clean URLs. Keep the legacy
        // public shell URL and private application/API surfaces out of crawler
        // indexes, but allow static chunks needed to render public pages.
        res.write(renderPublicRobots(req));
      }
      res.end();
    } catch (err) {
      logger.warn("robots endpoint failed", { err: `${err}` });
      res.status(500).type("text/plain").send("internal error");
    }
  };
}
