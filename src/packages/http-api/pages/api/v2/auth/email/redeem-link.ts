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
import { redeemEmailAuthLink } from "@cocalc/server/inter-bay/email-auth";

import { emailAuthErrorPayload } from "./_shared";

export async function redeemLink(req, res) {
  try {
    const { challenge_id, token } = getParams(req);
    res.json(
      await redeemEmailAuthLink({
        challenge_id: `${challenge_id ?? ""}`.trim(),
        token: `${token ?? ""}`.trim(),
      }),
    );
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
