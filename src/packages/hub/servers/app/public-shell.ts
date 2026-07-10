/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Request, Response } from "express";
import { existsSync } from "fs";
import { readFile, stat } from "fs/promises";
import { join } from "path";

import basePath from "@cocalc/backend/base-path";
import { getFeedData } from "@cocalc/database/postgres/news";
import getCustomize from "@cocalc/database/settings/customize";
import { getLogger } from "@cocalc/hub/logger";
import { slugURL } from "@cocalc/util/news";
import { path as STATIC_PATH } from "@cocalc/static";
import {
  getPublicImageDimensions,
  getPublicMetadataRouteFromPath,
  getPublicRouteMetadata,
  PUBLIC_HEAD_PLACEHOLDER,
  PUBLIC_STATIC_BASE_PLACEHOLDER,
  type PublicRouteMetadataConfig,
} from "@cocalc/util/public-site-metadata";
import { initPublicDocsMetadata } from "@cocalc/util/public-site-metadata-docs";
import { joinUrlPath } from "@cocalc/util/url-path";
import {
  getCocalcProduct,
  isLaunchpadProduct,
} from "@cocalc/server/launchpad/mode";

const logger = getLogger("hub:servers:public-shell");

// Docs route metadata (per-entry titles, noindex, 404 detection) needs the
// docs registry, which is only wired in on demand; on the server that is
// simply at startup.
initPublicDocsMetadata();

const FALLBACK_PUBLIC_HTML = `<!DOCTYPE html>
<html>
<head>
  ${PUBLIC_HEAD_PLACEHOLDER}
</head>
<body>
  <div id="cocalc-crash-container"></div>
  <div id="cocalc-load-container"></div>
  <div id="cocalc-scripts-container"></div>
  <div id="cocalc-webapp-container"></div>
</body>
</html>`;

function htmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function requestOrigin(req: Request): string {
  return `${req.protocol}://${req.get("host")}`;
}

function absolutePublicUrl(req: Request, path: string): string {
  if (/^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  return `${requestOrigin(req)}${path.startsWith("/") ? path : `/${path}`}`;
}

function getSearch(req: Request): string {
  return req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
}

function targetFromStaticShell(req: Request): string | undefined {
  if (req.path !== "/static/public.html") return undefined;
  const target = req.query?.target;
  return typeof target === "string" && target.startsWith("/")
    ? target
    : undefined;
}

function metadataPathAndSearch(req: Request): { path: string; search: string } {
  const target = targetFromStaticShell(req);
  if (target) {
    const index = target.indexOf("?");
    if (index >= 0) {
      return {
        path: target.slice(0, index),
        search: target.slice(index),
      };
    }
    return { path: target, search: "" };
  }
  return {
    path: joinUrlPath(basePath, req.path),
    search: getSearch(req),
  };
}

function publicMetadataConfig(req: Request): PublicRouteMetadataConfig {
  const customize = (req as any).cocalcPublicCustomize;
  return {
    cocalc_product: getCocalcProduct(),
    dns: req.get("host"),
    is_launchpad: isLaunchpadProduct(),
    logo_square: customize?.logoSquareURL,
    site_name: customize?.siteName,
  };
}

function metaTag(attrs: Record<string, string>): string {
  const rendered = Object.entries(attrs)
    .map(([name, value]) => `${name}="${htmlEscape(value)}"`)
    .join(" ");
  return `<meta ${rendered}>`;
}

function stripMarkdownSummary(text?: string): string {
  return `${text ?? ""}`
    .replace(/!\[[^\]]*\]\([^)]+\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[`*_>#-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

// News detail metadata cannot come from the shared registry-based helper:
// the post lives in the database. Resolve it here so /news/<slug>-<id>
// canonicalizes to the post's real slug URL (a mistyped slug still resolves
// by id and canonicalizes to the correct URL), gets the actual title and a
// summary, and a nonexistent or unpublished id is a real 404.
async function resolveNewsMetadata(
  req: Request,
  route: ReturnType<typeof getPublicMetadataRouteFromPath>,
  metadata: ReturnType<typeof getPublicRouteMetadata>,
): Promise<typeof metadata> {
  if (
    route.section !== "news" ||
    (route.route?.view !== "news-detail" &&
      route.route?.view !== "news-history")
  ) {
    return metadata;
  }
  const newsId = `${route.route.newsSlug}`.split("-").pop();
  const item = (await getFeedData()).find((it) => `${it.id}` === newsId);
  if (item == null) {
    return { ...metadata, notFound: true };
  }
  const customize = (req as any).cocalcPublicCustomize;
  const siteName = customize?.siteName ?? "CoCalc";
  const description = stripMarkdownSummary(item.text);
  return {
    ...metadata,
    canonicalPath: joinUrlPath(basePath, slugURL(item)),
    ...(description ? { description } : {}),
    notFound: false,
    title: item.title === siteName ? item.title : `${item.title} | ${siteName}`,
  };
}

async function buildHead(
  req: Request,
): Promise<{ head: string; notFound: boolean }> {
  const { path, search } = metadataPathAndSearch(req);
  const route = getPublicMetadataRouteFromPath(path, search, {
    basePath,
  });
  const metadata = await resolveNewsMetadata(
    req,
    route,
    getPublicRouteMetadata(route, publicMetadataConfig(req), {
      basePath,
    }),
  );
  const canonicalUrl = absolutePublicUrl(req, metadata.canonicalPath);
  const imageUrl = absolutePublicUrl(req, metadata.imagePath);
  const imageDimensions = getPublicImageDimensions(metadata.imagePath);
  const socialTags = [
    ...(metadata.noindex
      ? [
          metaTag({
            content: "noindex",
            "data-cocalc-public-route-meta": "robots",
            name: "robots",
          }),
        ]
      : []),
    metaTag({
      content: metadata.description,
      "data-cocalc-public-route-meta": "description",
      name: "description",
    }),
    `<link data-cocalc-public-route-meta="canonical" href="${htmlEscape(
      canonicalUrl,
    )}" rel="canonical">`,
    metaTag({
      content: "website",
      "data-cocalc-public-route-meta": "og:type",
      property: "og:type",
    }),
    metaTag({
      content: metadata.title,
      "data-cocalc-public-route-meta": "og:title",
      property: "og:title",
    }),
    metaTag({
      content: metadata.description,
      "data-cocalc-public-route-meta": "og:description",
      property: "og:description",
    }),
    metaTag({
      content: canonicalUrl,
      "data-cocalc-public-route-meta": "og:url",
      property: "og:url",
    }),
    metaTag({
      content: imageUrl,
      "data-cocalc-public-route-meta": "og:image",
      property: "og:image",
    }),
    ...(imageDimensions
      ? [
          metaTag({
            content: `${imageDimensions.width}`,
            "data-cocalc-public-route-meta": "og:image:width",
            property: "og:image:width",
          }),
          metaTag({
            content: `${imageDimensions.height}`,
            "data-cocalc-public-route-meta": "og:image:height",
            property: "og:image:height",
          }),
        ]
      : []),
    metaTag({
      content: "summary_large_image",
      "data-cocalc-public-route-meta": "twitter:card",
      name: "twitter:card",
    }),
    metaTag({
      content: metadata.title,
      "data-cocalc-public-route-meta": "twitter:title",
      name: "twitter:title",
    }),
    metaTag({
      content: metadata.description,
      "data-cocalc-public-route-meta": "twitter:description",
      name: "twitter:description",
    }),
    metaTag({
      content: imageUrl,
      "data-cocalc-public-route-meta": "twitter:image",
      name: "twitter:image",
    }),
  ].join("\n  ");

  return {
    head: `${basePathMetaTag()}\n  <title>${htmlEscape(
      metadata.title,
    )}</title>\n  ${socialTags}`,
    notFound: !!metadata.notFound,
  };
}

function staticBasePath(): string {
  return joinUrlPath(basePath, "static");
}

// The client cannot infer the serve-time base path from a clean page URL
// like /docs/a/b, so the shell head states it explicitly;
// @cocalc/frontend/customize/app-base-path reads this tag first.
function basePathMetaTag(): string {
  return `<meta name="cocalc-base-path" content="${htmlEscape(basePath)}">`;
}

// Legacy shells (built before the static-base token) have script URLs
// relative to /static/, so serving them at clean URLs needs a page-wide
// <base> tag. It must come before the plugin-emitted <script> tags, which
// follow the marker region.
// TODO remove together with the legacy branches in injectHead once all
// deployed static artifacts carry PUBLIC_STATIC_BASE_PLACEHOLDER.
function staticBaseTag(): string {
  return `<base href="${htmlEscape(`${staticBasePath()}/`)}">`;
}

// Cache the shell file content keyed by mtime/size: serving public pages is
// hot and the file only changes when static is rebuilt, so a cheap stat per
// request replaces a full read; a rebuild bumps the mtime and refreshes the
// cache automatically (important for dev, where static rebuilds while the
// hub keeps running).
let cachedShell:
  | { file: string; mtimeMs: number; size: number; html: string }
  | undefined;

async function publicHtml(): Promise<string> {
  try {
    const file = join(resolveStaticPath(), "public.html");
    const { mtimeMs, size } = await stat(file);
    if (
      cachedShell != null &&
      cachedShell.file === file &&
      cachedShell.mtimeMs === mtimeMs &&
      cachedShell.size === size
    ) {
      return cachedShell.html;
    }
    const html = await readFile(file, "utf8");
    cachedShell = { file, mtimeMs, size, html };
    return html;
  } catch {
    return FALLBACK_PUBLIC_HTML;
  }
}

// The resolved directory cannot change for the lifetime of the process, so
// resolve it once; a miss (no built static assets yet) is not memoized so a
// build that finishes after hub startup is still picked up.
let resolvedStaticPath: string | undefined;

export function resolveStaticPath(): string {
  if (resolvedStaticPath != null) {
    return resolvedStaticPath;
  }
  const candidates: string[] = [];
  if (process.env.COCALC_STATIC_PATH) {
    candidates.push(process.env.COCALC_STATIC_PATH);
  }
  if (process.env.COCALC_BUNDLE_DIR) {
    candidates.push(join(process.env.COCALC_BUNDLE_DIR, "static"));
  }
  candidates.push(
    STATIC_PATH,
    join(process.cwd(), "static"),
    join(process.cwd(), "packages", "static", "dist"),
    join(__dirname, "..", "static"),
  );
  for (const candidate of candidates) {
    if (existsSync(join(candidate, "app.html"))) {
      resolvedStaticPath = candidate;
      return candidate;
    }
  }
  return STATIC_PATH;
}

let warnedAboutMissingPlaceholder = false;

// Rewrite the shell for serving: resolve the static-base token into the
// serve-time asset location, then replace the shared title placeholder with
// the rendered head using exact string splicing only. Unlike comments, the
// title survives Rspack's production HTML minification. Legacy artifacts
// without the token get a page-wide <base> tag instead — that breaks
// same-page fragment links (href="#..." resolves to /static/#...), which is
// why new artifacts use absolute asset URLs. If the placeholder is missing
// or duplicated, skip the per-route metadata but keep the asset URLs
// working — otherwise the stale shell renders blank. Log so the stale
// static build gets noticed.
function injectHead(html: string, head: string): string {
  const tokenized = html.includes(PUBLIC_STATIC_BASE_PLACEHOLDER);
  if (tokenized) {
    html = html
      .split(PUBLIC_STATIC_BASE_PLACEHOLDER)
      .join(htmlEscape(staticBasePath()));
  }
  const index = html.indexOf(PUBLIC_HEAD_PLACEHOLDER);
  const duplicate =
    index >= 0
      ? html.indexOf(
          PUBLIC_HEAD_PLACEHOLDER,
          index + PUBLIC_HEAD_PLACEHOLDER.length,
        )
      : -1;
  if (index < 0 || duplicate >= 0) {
    if (!warnedAboutMissingPlaceholder) {
      warnedAboutMissingPlaceholder = true;
      logger.warn(
        "public.html must contain exactly one public head placeholder; serving shell without per-route metadata — rebuild @cocalc/static",
      );
    }
    if (tokenized) {
      return html;
    }
    return html.replace(
      /<head[^>]*>/i,
      (match) => `${match}${staticBaseTag()}`,
    );
  }
  const spliced = tokenized ? head : `${staticBaseTag()}\n  ${head}`;
  return (
    html.slice(0, index) +
    spliced +
    html.slice(index + PUBLIC_HEAD_PLACEHOLDER.length)
  );
}

export async function renderPublicShell(
  req: Request,
): Promise<{ html: string; status: 200 | 404 }> {
  const customize = await getCustomize();
  (req as any).cocalcPublicCustomize = customize;
  const html = await publicHtml();
  const { head, notFound } = await buildHead(req);
  return { html: injectHead(html, head), status: notFound ? 404 : 200 };
}

export function servePublicShell(req: Request, res: Response): void {
  void renderPublicShell(req)
    .then(({ html, status }) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=10, must-revalidate");
      // The body embeds host-derived canonical/og URLs and host-dependent
      // policy, so shared caches must key on the host.
      res.vary("Host");
      res.status(status).send(html);
    })
    .catch((err) => {
      logger.warn("serving public shell failed", { err: `${err}` });
      res.status(500).type("text/plain").send("internal error");
    });
}
