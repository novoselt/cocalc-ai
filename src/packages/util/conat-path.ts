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
