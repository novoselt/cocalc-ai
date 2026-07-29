/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { FRESH_AUTH_DEFAULT_MS } from "@cocalc/server/auth/auth-sessions";
import { verifyHomeBayRetryToken } from "@cocalc/server/auth/home-bay-retry-token";
import {
  createSignInSecondFactorChallenge,
  hasActiveSecondFactor,
} from "@cocalc/server/auth/two-factor";
import { emailRequiresCocalc2fa } from "@cocalc/database/settings/sso-policies";
import getPool from "@cocalc/database/pool";
import getParams from "@cocalc/http-api/lib/api/get-params";
import isPost from "@cocalc/http-api/lib/api/is-post";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { getBayPublicOriginForRequest } from "@cocalc/server/bay-public-origin";
import { consumeEmailAuthExchange } from "@cocalc/server/inter-bay/email-auth";

import { emailAuthErrorPayload } from "./_shared";
import { signUserIn } from "../sign-in";

export async function exchange(req, res) {
  if (!isPost(req, res)) {
    return;
  }
  try {
    const retryToken = `${getParams(req).retry_token ?? ""}`.trim();
    const homeBayId = getConfiguredBayId();
    const claims = verifyHomeBayRetryToken({
      token: retryToken,
      home_bay_id: homeBayId,
      purpose: "email-auth",
    });
    if (!claims.account_id || !claims.challenge_id) {
      throw new Error("Email sign-in exchange is incomplete.");
    }
    if (!claims.primary_auth_method || !claims.primary_verified_at) {
      throw new Error("Email sign-in exchange has no primary proof.");
    }
    const account = (
      await getPool().query<{
        banned?: boolean | null;
        email_address?: string | null;
      }>(
        `SELECT banned, email_address FROM accounts WHERE account_id=$1::UUID`,
        [claims.account_id],
      )
    ).rows[0];
    if (
      !account ||
      account.banned === true ||
      `${account.email_address ?? ""}`.trim().toLowerCase() !==
        `${claims.email ?? ""}`.trim().toLowerCase()
    ) {
      throw new Error("This account is not allowed to sign in.");
    }

    const hasSecondFactor = await hasActiveSecondFactor(claims.account_id);
    if (
      (await emailRequiresCocalc2fa(account.email_address ?? "")) &&
      !hasSecondFactor
    ) {
      throw new Error(
        "This email domain requires CoCalc two-factor authentication. Contact your site administrator to enable 2FA before signing in.",
      );
    }
    const primaryVerifiedAt = new Date(claims.primary_verified_at);
    if (!Number.isFinite(primaryVerifiedAt.valueOf())) {
      throw new Error("Email sign-in proof timestamp is invalid.");
    }
    let challenge;
    if (hasSecondFactor) {
      challenge = await createSignInSecondFactorChallenge({
        account_id: claims.account_id,
        metadata: {
          email_auth_challenge_id: claims.challenge_id,
        },
        primary_auth_method: claims.primary_auth_method,
        primary_verified_at: primaryVerifiedAt,
      });
    }
    const emailProof = await consumeEmailAuthExchange({
      account_id: claims.account_id,
      challenge_id: claims.challenge_id,
      completion: hasSecondFactor ? "mfa_required" : "completed",
      exchange_id: claims.jti,
      home_bay_id: homeBayId,
    });
    if (
      emailProof.auth_method !== claims.primary_auth_method ||
      new Date(emailProof.email_proved_at).valueOf() !==
        primaryVerifiedAt.valueOf()
    ) {
      throw new Error("Email sign-in proof does not match the exchange.");
    }
    if (hasSecondFactor) {
      res.json({
        mfa_required: true,
        challenge_id: challenge!.challenge_id,
        methods: challenge!.methods,
        home_bay_id: homeBayId,
        home_bay_url: await getBayPublicOriginForRequest(req, homeBayId),
      });
      return;
    }
    await signUserIn(req, res, claims.account_id, {
      authenticated_at: new Date(),
      password_verified_at: null,
      primary_verified_at: primaryVerifiedAt,
      primary_auth_method: emailProof.auth_method,
      factor_level: "none",
      fresh_auth_until: new Date(Date.now() + FRESH_AUTH_DEFAULT_MS),
    });
  } catch (err) {
    res.json(emailAuthErrorPayload(err));
  }
}

export default exchange;
