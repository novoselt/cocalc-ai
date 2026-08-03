/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ApiV2RouteEntry } from "./api-v2-routes";

import authBootstrap from "../pages/api/v2/auth/bootstrap";
import authFreshAuth from "../pages/api/v2/auth/fresh-auth";
import authRequiresToken from "../pages/api/v2/auth/requires-token";
import authSignIn from "../pages/api/v2/auth/sign-in";
import authSignInMethod from "../pages/api/v2/auth/sign-in-method";
import authSignUp from "../pages/api/v2/auth/sign-up";
import accountSendVerificationEmail from "../pages/api/v2/accounts/send-verification-email";
import accountSetEmailAddress from "../pages/api/v2/accounts/set-email-address";

export function getLaunchpadApiV2Routes(): ApiV2RouteEntry[] {
  return [
    { path: "/auth/bootstrap", handler: authBootstrap },
    { path: "/auth/fresh-auth", handler: authFreshAuth },
    { path: "/auth/requires-token", handler: authRequiresToken },
    { path: "/auth/sign-in", handler: authSignIn },
    { path: "/auth/sign-in-method", handler: authSignInMethod },
    { path: "/auth/sign-up", handler: authSignUp },
    {
      path: "/accounts/send-verification-email",
      handler: accountSendVerificationEmail,
    },
    { path: "/accounts/set-email-address", handler: accountSetEmailAddress },
  ];
}
