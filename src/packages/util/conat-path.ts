/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { joinUrlPath } from "./url-path";

export const DEFAULT_CONAT_PATH_COMPONENT = "conat";

const PATH_COMPONENT_RE = /^[a-z0-9][a-z0-9._~-]{0,62}$/i;

export function normalizeConatPathComponent(value?: string | null): string {
  const component = `${value ?? DEFAULT_CONAT_PATH_COMPONENT}`.trim();
  if (!PATH_COMPONENT_RE.test(component)) {
    throw new Error(
      `invalid Conat path component '${component}'; expected one URL path component`,
    );
  }
  return component;
}

export function conatPathForBase(
  basePath: string,
  component?: string | null,
): string {
  const absoluteBase = basePath.startsWith("/")
    ? basePath
    : basePath
      ? `/${basePath}`
      : "/";
  return joinUrlPath(absoluteBase, normalizeConatPathComponent(component));
}

export function conatProxyPathsForBase(
  basePath: string,
  publicComponent?: string | null,
): string[] {
  const canonical = conatPathForBase(basePath);
  const publicPath = conatPathForBase(basePath, publicComponent);
  return publicPath === canonical ? [canonical] : [canonical, publicPath];
}

export function canonicalConatProxyPath(
  rawUrl: string | undefined,
  publicComponent?: string | null,
): string {
  const url = new URL(`${rawUrl ?? "/"}`, "http://cocalc.invalid");
  const components = [
    normalizeConatPathComponent(publicComponent),
    DEFAULT_CONAT_PATH_COMPONENT,
  ];
  for (const component of new Set(components)) {
    const marker = `/${component}`;
    const index = url.pathname.lastIndexOf(marker);
    if (index === -1) {
      continue;
    }
    const suffix = url.pathname.slice(index + marker.length);
    if (suffix && !suffix.startsWith("/")) {
      continue;
    }
    return `/${DEFAULT_CONAT_PATH_COMPONENT}${suffix}${url.search}`;
  }
  throw new Error(`invalid Conat proxy path: ${rawUrl ?? "/"}`);
}
