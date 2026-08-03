/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getAccountId from "@cocalc/http-api/lib/account/get-account";
import getParams from "@cocalc/http-api/lib/api/get-params";
import isPost from "@cocalc/http-api/lib/api/is-post";
import { getRememberMeHash } from "@cocalc/server/auth/remember-me";
import { redeemEmailAuthCode } from "@cocalc/server/inter-bay/email-auth";

import { emailAuthErrorPayload } from "@cocalc/http-api/lib/auth/email-shared";

export default async function redeemEmailFreshAuthCode(req, res) {
  if (!isPost(req, res)) {
    return;
  }
  try {
    const account_id = await getAccountId(req);
    if (!account_id || !getRememberMeHash(req)) {
      throw new Error("browser sign-in is required");
    }
    const { challenge_id, code } = getParams(req);
    const status = await redeemEmailAuthCode({
      challenge_id: `${challenge_id ?? ""}`.trim(),
      code: `${code ?? ""}`.trim(),
    });
    if (status.purpose !== "email_fresh_auth") {
      throw new Error("This is not a fresh-auth email challenge.");
    }
    res.json(status);
  } catch (err) {
    res.json(emailAuthErrorPayload(err));
  }
}
