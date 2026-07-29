/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { apiRoute, apiRouteOperation } from "@cocalc/http-api/lib/api";
import getParams from "@cocalc/http-api/lib/api/get-params";
import {
  EmailAuthChallengeOutputSchema,
  EmailAuthRedeemLinkInputSchema,
} from "@cocalc/http-api/lib/api/schema/auth/email";
import {
  prepareEmailAuthExchange,
  redeemEmailAuthLink,
} from "@cocalc/server/inter-bay/email-auth";
import { getBayPublicOriginForRequest } from "@cocalc/server/bay-public-origin";

import { emailAuthErrorPayload } from "./_shared";

export async function redeemLink(req, res) {
  try {
    const { challenge_id, token } = getParams(req);
    const normalizedChallengeId = `${challenge_id ?? ""}`.trim();
    const status = await redeemEmailAuthLink({
      challenge_id: normalizedChallengeId,
      token: `${token ?? ""}`.trim(),
    });
    if (status.purpose === "email_fresh_auth") {
      res.json(status);
      return;
    }
    const exchange = await prepareEmailAuthExchange({
      challenge_id: normalizedChallengeId,
      auth_method: "email_link",
    });
    res.json({
      ...exchange,
      home_bay_url: await getBayPublicOriginForRequest(
        req,
        exchange.home_bay_id,
      ),
    });
  } catch (err) {
    res.json(emailAuthErrorPayload(err));
  }
}

export default apiRoute({
  redeemLink: apiRouteOperation({
    method: "POST",
    openApiOperation: { tags: ["Auth"] },
  })
    .input({
      contentType: "application/json",
      body: EmailAuthRedeemLinkInputSchema,
    })
    .outputs([
      {
        status: 200,
        contentType: "application/json",
        body: EmailAuthChallengeOutputSchema,
      },
    ])
    .handler(redeemLink),
});
