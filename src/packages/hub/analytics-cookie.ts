/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import ms from "ms";

import { analytics_cookie_name, uuid } from "@cocalc/util/misc";

export function setAnalyticsCookie(
  res,
  analyticsToken: string = uuid(),
): string {
  // Do not set a domain here so this also works on custom and local domains.
  // The analytics script sets the same token on the registrable domain when
  // cross-subdomain attribution is available.
  res.cookie(analytics_cookie_name, analyticsToken, {
    path: "/",
    maxAge: ms("7 days"),
  });
  return analyticsToken;
}
