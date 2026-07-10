/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Request, Response } from "express";

import basePath from "@cocalc/backend/base-path";
import { getFeedData } from "@cocalc/database/postgres/news";
import { docsPath, listDocsEntries, type DocsAccess } from "@cocalc/docs";
import { getLogger } from "@cocalc/hub/logger";
import { slugURL } from "@cocalc/util/news";
import { PUBLIC_SITEMAP_PATHS } from "@cocalc/util/public-site-metadata";
import { joinUrlPath } from "@cocalc/util/url-path";
import {
  isCanonicalPublicSiteHost,
  isCocalcAiOnlyPublicPath,
} from "@cocalc/util/public-site-policy";

export { PUBLIC_SITEMAP_PATHS } from "@cocalc/util/public-site-metadata";

const logger = getLogger("hub:servers:sitemap");

function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function requestOrigin(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

export function sitemapLocation(req: Request, path: string): string {
  return `${requestOrigin(req)}${joinUrlPath(basePath, path)}`;
}

function docsAccessForRequest(req: Request): DocsAccess {
  return {
    siteProfile: isCanonicalPublicSiteHost(req.get("host"))
      ? "cocalc-ai"
      : undefined,
  };
}

function uniquePaths(paths: string[]): string[] {
  const seen = new Set<string>();
  return paths.filter((path) => {
    if (seen.has(path)) return false;
    seen.add(path);
    return true;
  });
}

export function publicSitemapPaths(req: Request): string[] {
  const staticPaths = isCanonicalPublicSiteHost(req.get("host"))
    ? PUBLIC_SITEMAP_PATHS
    : PUBLIC_SITEMAP_PATHS.filter((path) => !isCocalcAiOnlyPublicPath(path));
  return uniquePaths([
    ...staticPaths,
    ...listDocsEntries(docsAccessForRequest(req)).map((entry) =>
      docsPath(entry.slug),
    ),
  ]);
}

// Published news posts (getFeedData is cached and already excludes hidden
// and future items).
async function newsSitemapPaths(): Promise<string[]> {
  return (await getFeedData()).map((item) => slugURL(item));
}

export async function renderSitemapXml(req: Request): Promise<string> {
  const paths = uniquePaths([
    ...publicSitemapPaths(req),
    ...(await newsSitemapPaths()),
  ]);
  const urls = paths
    .map((path) => {
      return `  <url><loc>${xmlEscape(sitemapLocation(req, path))}</loc></url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

export default function getHandler() {
  return (req: Request, res: Response) => {
    renderSitemapXml(req)
      .then((xml) => {
        res.header("Content-Type", "application/xml; charset=utf-8");
        res.header("Cache-Control", "public, max-age=3600, must-revalidate");
        res.vary("Host");
        res.send(xml);
      })
      .catch((err) => {
        logger.warn("sitemap endpoint failed", { err: `${err}` });
        res.status(500).type("text/plain").send("internal error");
      });
  };
}
