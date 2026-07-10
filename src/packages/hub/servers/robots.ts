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
  const privateAppRoutes = Array.from(APP_ROUTES)
    .filter((route) => !INDEXABLE_APP_ROUTES.has(route))
    .map((route) => `Disallow: /${route}`);

  return [
    "User-agent: *",
    "Allow: /",
    "Allow: /share",
    "Allow: /share/",
    "Allow: /static/",
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
        // Hosted CoCalc serves public pages through static HTML shells. Allow
        // those page shells and public routes, but keep compiled assets and
        // private application/API surfaces out of crawler indexes.
        res.write(renderPublicRobots(req));
      }
      res.end();
    } catch (err) {
      logger.warn("robots endpoint failed", { err: `${err}` });
      res.status(500).type("text/plain").send("internal error");
    }
  };
}
