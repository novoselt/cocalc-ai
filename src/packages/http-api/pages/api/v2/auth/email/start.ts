/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getStrategies from "@cocalc/database/settings/get-sso-strategies";
import { apiRoute, apiRouteOperation } from "@cocalc/http-api/lib/api";
import getParams from "@cocalc/http-api/lib/api/get-params";
import {
  EmailAuthStartInputSchema,
  EmailAuthStartOutputSchema,
} from "@cocalc/http-api/lib/api/schema/auth/email";
import { checkRequiredSSO } from "@cocalc/server/auth/sso/check-required-sso";
import { startEmailAuthChallenge } from "@cocalc/server/inter-bay/email-auth";

import {
  assertEmailAuthStartEnabled,
  emailAuthErrorPayload,
  getOrSetEmailAuthBrowserBinding,
} from "./_shared";

export async function start(req, res) {
  try {
    await assertEmailAuthStartEnabled();
    const { email: rawEmail, analytics_token } = getParams(req);
    const email = `${rawEmail ?? ""}`.trim().toLowerCase();
    const strategy = checkRequiredSSO({
      email,
      strategies: await getStrategies(),
    });
    if (strategy) {
      res.json({
        sso_required: true,
        strategy: {
          name: strategy.name,
          display: strategy.display,
        },
      });
      return;
    }
    res.json(
      await startEmailAuthChallenge({
        email_address: email,
        browser_binding: getOrSetEmailAuthBrowserBinding(req, res),
        request_ip: req.ip,
        analytics_token: `${analytics_token ?? ""}`.trim() || undefined,
      }),
    );
  } catch (err) {
    res.json(emailAuthErrorPayload(err));
  }
}

export default apiRoute({
  start: apiRouteOperation({
    method: "POST",
    openApiOperation: { tags: ["Auth"] },
  })
    .input({
      contentType: "application/json",
      body: EmailAuthStartInputSchema,
    })
    .outputs([
      {
        status: 200,
        contentType: "application/json",
        body: EmailAuthStartOutputSchema,
      },
    ])
    .handler(start),
});
