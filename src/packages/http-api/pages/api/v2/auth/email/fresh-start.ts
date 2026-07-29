/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getAccountId from "@cocalc/http-api/lib/account/get-account";
import getParams from "@cocalc/http-api/lib/api/get-params";
import isPost from "@cocalc/http-api/lib/api/is-post";
import getEmailAddress from "@cocalc/server/accounts/get-email-address";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { getRememberMeHash } from "@cocalc/server/auth/remember-me";
import { startEmailAuthChallenge } from "@cocalc/server/inter-bay/email-auth";

import {
  emailAuthErrorPayload,
  getOrSetEmailAuthBrowserBinding,
} from "./_shared";

export default async function startEmailFreshAuth(req, res) {
  if (!isPost(req, res)) {
    return;
  }
  try {
    const account_id = await getAccountId(req);
    if (!account_id || !getRememberMeHash(req)) {
      throw new Error("browser sign-in is required");
    }
    const email_address = await getEmailAddress(account_id);
    if (!email_address) {
      throw new Error("The signed-in account has no email address.");
    }
    const { analytics_token } = getParams(req);
    res.json(
      await startEmailAuthChallenge({
        email_address,
        browser_binding: getOrSetEmailAuthBrowserBinding(req, res),
        request_ip: req.ip,
        analytics_token: `${analytics_token ?? ""}`.trim() || undefined,
        purpose: "email_fresh_auth",
        expected_account_id: account_id,
        prospective_home_bay_id: getConfiguredBayId(),
      }),
    );
  } catch (err) {
    res.json(emailAuthErrorPayload(err));
  }
}
