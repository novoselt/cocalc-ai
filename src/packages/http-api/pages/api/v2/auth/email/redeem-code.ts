/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { apiRoute, apiRouteOperation } from "@cocalc/http-api/lib/api";
import getParams from "@cocalc/http-api/lib/api/get-params";
import {
  EmailAuthChallengeOutputSchema,
  EmailAuthRedeemCodeInputSchema,
} from "@cocalc/http-api/lib/api/schema/auth/email";
import { redeemEmailAuthCode } from "@cocalc/server/inter-bay/email-auth";

import { emailAuthErrorPayload } from "./_shared";

export async function redeemCode(req, res) {
  try {
    const { challenge_id, code } = getParams(req);
    res.json(
      await redeemEmailAuthCode({
        challenge_id: `${challenge_id ?? ""}`.trim(),
        code: `${code ?? ""}`.trim(),
      }),
    );
  } catch (err) {
    res.json(emailAuthErrorPayload(err));
  }
}

export default apiRoute({
  redeemCode: apiRouteOperation({
    method: "POST",
    openApiOperation: { tags: ["Auth"] },
  })
    .input({
      contentType: "application/json",
      body: EmailAuthRedeemCodeInputSchema,
    })
    .outputs([
      {
        status: 200,
        contentType: "application/json",
        body: EmailAuthChallengeOutputSchema,
      },
    ])
    .handler(redeemCode),
});
