/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Request, Response } from "express";
import { existsSync } from "fs";
import { readFile } from "fs/promises";
import { join } from "path";

import basePath from "@cocalc/backend/base-path";
import getCustomize from "@cocalc/database/settings/customize";
import { path as STATIC_PATH } from "@cocalc/static";
import {
  getPublicImageDimensions,
  getPublicMetadataRouteFromPath,
  getPublicRouteMetadata,
  type PublicRouteMetadataConfig,
} from "@cocalc/util/public-site-metadata";
import { joinUrlPath } from "@cocalc/util/url-path";
import {
  getCocalcProduct,
  isLaunchpadProduct,
} from "@cocalc/server/launchpad/mode";

const FALLBACK_PUBLIC_HTML = `<!DOCTYPE html>
<html>
<head>
  <title>CoCalc</title>
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

function buildHead(req: Request): string {
  const { path, search } = metadataPathAndSearch(req);
  const route = getPublicMetadataRouteFromPath(path, search, {
    basePath,
  });
  const metadata = getPublicRouteMetadata(route, publicMetadataConfig(req), {
    basePath,
  });
  const canonicalUrl = absolutePublicUrl(req, metadata.canonicalPath);
  const imageUrl = absolutePublicUrl(req, metadata.imagePath);
  const imageDimensions = getPublicImageDimensions(metadata.imagePath);
  const socialTags = [
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

  return `<title>${htmlEscape(metadata.title)}</title>\n  ${socialTags}`;
}

async function publicHtml(): Promise<string> {
  try {
    return await readFile(join(resolveStaticPath(), "public.html"), "utf8");
  } catch {
    return FALLBACK_PUBLIC_HTML;
  }
}

export function resolveStaticPath(): string {
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
      return candidate;
    }
  }
  return STATIC_PATH;
}

export async function renderPublicShell(req: Request): Promise<string> {
  const customize = await getCustomize();
  (req as any).cocalcPublicCustomize = customize;
  const html = await publicHtml();
  const head = buildHead(req);
  if (/<title>[\s\S]*?<\/title>/i.test(html)) {
    return html.replace(/<title>[\s\S]*?<\/title>/i, head);
  }
  return html.replace(/<\/head>/i, `  ${head}\n</head>`);
}

export function servePublicShell(req: Request, res: Response): void {
  void renderPublicShell(req)
    .then((html) => {
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      res.setHeader("Cache-Control", "public, max-age=10, must-revalidate");
      res.status(200).send(html);
    })
    .catch((err) => {
      res.status(500).send(`${err}`);
    });
}
