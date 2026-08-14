/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import isPost from "@cocalc/http-api/lib/api/is-post";
import { listPendingCliFreshAuthChallenges } from "@cocalc/server/auth/cli-auth";
import getAccountId from "@cocalc/server/auth/get-account";

export default async function cliPendingFreshAuth(req, res) {
  if (!isPost(req, res)) {
    return;
  }

  try {
    if (req.header("Authorization")) {
      throw new Error("interactive browser sign-in is required");
    }
    const account_id = await getAccountId(req);
    if (!account_id) {
      throw new Error("interactive browser sign-in is required");
    }
    res.json({
      challenges: await listPendingCliFreshAuthChallenges({ req, account_id }),
    });
  } catch (err) {
    res.json({
      error:
        err instanceof Error
          ? err.message
          : "Problem loading pending CLI authentication requests.",
    });
  }
}
