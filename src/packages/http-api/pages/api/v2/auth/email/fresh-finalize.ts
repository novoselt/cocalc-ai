/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getAccountId from "@cocalc/http-api/lib/account/get-account";
import getParams from "@cocalc/http-api/lib/api/get-params";
import isPost from "@cocalc/http-api/lib/api/is-post";
import {
  FRESH_AUTH_DEFAULT_MS,
  requireFreshAuth,
  setCurrentSessionFreshAuth,
} from "@cocalc/server/auth/auth-sessions";
import { getRememberMeHash } from "@cocalc/server/auth/remember-me";
import { hasActiveSecondFactor } from "@cocalc/server/auth/two-factor";
import { completeEmailFreshAuth } from "@cocalc/server/inter-bay/email-auth";

import { emailAuthErrorPayload } from "./_shared";

export default async function finalizeEmailFreshAuth(req, res) {
  if (!isPost(req, res)) {
    return;
  }
  try {
    const account_id = await getAccountId(req);
    if (!account_id || !getRememberMeHash(req)) {
      throw new Error("browser sign-in is required");
    }
    const { challenge_id } = getParams(req);
    const hasSecondFactor = await hasActiveSecondFactor(account_id);
    if (hasSecondFactor) {
      await requireFreshAuth({ req, account_id });
    }
    const proof = await completeEmailFreshAuth({
      account_id,
      challenge_id: `${challenge_id ?? ""}`.trim(),
    });
    if (!hasSecondFactor) {
      const primaryVerifiedAt = new Date(proof.email_proved_at);
      await setCurrentSessionFreshAuth({
        req,
        account_id,
        factor_level: "none",
        fresh_auth_until: new Date(Date.now() + FRESH_AUTH_DEFAULT_MS),
        primary_auth_method: proof.auth_method,
        primary_verified_at: primaryVerifiedAt,
        metadata_patch: {
          email_fresh_auth_challenge_id: `${challenge_id ?? ""}`.trim(),
        },
      });
    }
    res.json({
      ok: true,
      fresh_auth_until: new Date(
        Date.now() + FRESH_AUTH_DEFAULT_MS,
      ).toISOString(),
    });
  } catch (err) {
    res.json(emailAuthErrorPayload(err));
  }
}
