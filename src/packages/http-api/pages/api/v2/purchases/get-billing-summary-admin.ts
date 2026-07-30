/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getAccountId from "@cocalc/http-api/lib/account/get-account";
import getParams from "@cocalc/http-api/lib/api/get-params";
import userIsInGroup from "@cocalc/server/accounts/is-in-group";
import getBillingSummary from "@cocalc/server/purchases/get-billing-summary";
import throttle from "@cocalc/util/api/throttle";

export default async function handle(req, res) {
  try {
    res.json(await get(req));
  } catch (err) {
    res.json({ error: `${err.message}` });
  }
}

async function get(req) {
  if (req.header("Authorization")) {
    throw Error("API keys are not allowed to use admin HTTP API routes");
  }
  const admin_account_id = await getAccountId(req);
  if (admin_account_id == null) {
    throw Error("must be signed in");
  }
  if (!(await userIsInGroup(admin_account_id, "admin"))) {
    throw Error("only admins can use the get-billing-summary-admin endpoint");
  }
  throttle({
    account_id: admin_account_id,
    endpoint: "purchases/get-billing-summary-admin",
  });

  const { account_id } = getParams(req);
  if (!account_id) {
    throw Error("account_id is required");
  }
  return await getBillingSummary({ account_id });
}
