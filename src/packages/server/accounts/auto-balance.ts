/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { publishAccountRowFeedEventsBestEffort } from "@cocalc/server/account/account-row-feed";
import { withAccountRehomeWriteFence } from "@cocalc/server/accounts/rehome-fence";
import {
  ensureAutoBalanceValid,
  type AutoBalanceConfig,
} from "@cocalc/util/db-schema/accounts";
import { isValidUUID } from "@cocalc/util/misc";

function normalizeAutoBalanceConfig(
  auto_balance: AutoBalanceConfig,
): AutoBalanceConfig {
  const normalized: AutoBalanceConfig = {
    trigger: auto_balance?.trigger,
    amount: auto_balance?.amount,
    max_day: auto_balance?.max_day,
    max_week: auto_balance?.max_week,
    max_month: auto_balance?.max_month,
    period: auto_balance?.period,
    enabled: auto_balance?.enabled,
  };
  ensureAutoBalanceValid(normalized);
  return normalized;
}

function validateAccountId(account_id: string): string {
  const normalized = `${account_id ?? ""}`.trim().toLowerCase();
  if (!isValidUUID(normalized)) {
    throw Error("account_id must be a valid uuid");
  }
  return normalized;
}

export async function setAutoBalance({
  account_id,
  auto_balance,
}: {
  account_id: string;
  auto_balance: AutoBalanceConfig;
}): Promise<AutoBalanceConfig> {
  const accountId = validateAccountId(account_id);
  const normalized = normalizeAutoBalanceConfig(auto_balance);
  const updated = await withAccountRehomeWriteFence({
    account_id: accountId,
    action: "configure automatic deposits",
    fn: async (db) => {
      const { rows } = await db.query(
        `
          UPDATE accounts
             SET auto_balance=$1::JSONB
           WHERE account_id=$2
           RETURNING auto_balance
        `,
        [JSON.stringify(normalized), accountId],
      );
      if (rows.length === 0) {
        throw Error("no such account");
      }
      return rows[0].auto_balance as AutoBalanceConfig;
    },
  });
  await publishAccountRowFeedEventsBestEffort({
    account_id: accountId,
    patch: { auto_balance: updated },
  });
  return updated;
}
