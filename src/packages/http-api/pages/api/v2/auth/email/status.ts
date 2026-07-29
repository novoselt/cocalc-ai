/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { apiRoute, apiRouteOperation } from "@cocalc/http-api/lib/api";
import getParams from "@cocalc/http-api/lib/api/get-params";
import {
  EmailAuthChallengeOutputSchema,
  EmailAuthStatusInputSchema,
} from "@cocalc/http-api/lib/api/schema/auth/email";
import { getEmailAuthChallengeStatus } from "@cocalc/server/inter-bay/email-auth";

import {
  emailAuthErrorPayload,
  requireEmailAuthBrowserBinding,
} from "./_shared";

export async function status(req, res) {
  try {
    const { challenge_id } = getParams(req);
    res.json(
      await getEmailAuthChallengeStatus({
        challenge_id: `${challenge_id ?? ""}`.trim(),
        browser_binding: requireEmailAuthBrowserBinding(req),
      }),
    );
  } catch (err) {
    res.json(emailAuthErrorPayload(err));
  }
}

export default apiRoute({
  status: apiRouteOperation({
    method: "POST",
    openApiOperation: { tags: ["Auth"] },
  })
    .input({
      contentType: "application/json",
      body: EmailAuthStatusInputSchema,
    })
    .outputs([
      {
        status: 200,
        contentType: "application/json",
        body: EmailAuthChallengeOutputSchema,
      },
    ])
    .handler(status),
});
