/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool from "@cocalc/database/pool";
import type { PoolClient } from "@cocalc/database/pool";
import type { AccountBillingSummary } from "@cocalc/util/db-schema/purchases";
import { moneyToDbString } from "@cocalc/util/money";
import { COST_OR_METERED_COST } from "./get-balance";

export default async function getBillingSummary({
  account_id,
  client,
}: {
  account_id: string;
  client?: PoolClient;
}): Promise<AccountBillingSummary> {
  const pool = client ?? getPool();
  const { rows } = await pool.query(
    `
      WITH account_purchases AS (
        SELECT time, cost, ${COST_OR_METERED_COST} AS effective_cost
          FROM purchases
         WHERE account_id=$1
      )
      SELECT ROUND(-COALESCE(SUM(effective_cost), 0), 2) AS balance,
             ROUND(COALESCE(
               SUM(cost) FILTER (
                 WHERE cost > 0
                   AND time >= NOW() - INTERVAL '30 days'
               ),
               0
             ), 2) AS spend_30d,
             ROUND(COALESCE(
               SUM(cost) FILTER (
                 WHERE cost > 0
                   AND time >= NOW() - INTERVAL '365 days'
               ),
               0
             ), 2) AS spend_365d,
             MAX(time) AS last_transaction_at
        FROM account_purchases
    `,
    [account_id],
  );
  const row = rows[0] ?? {};
  return {
    balance: moneyToDbString(row.balance ?? 0),
    spend_30d: moneyToDbString(row.spend_30d ?? 0),
    spend_365d: moneyToDbString(row.spend_365d ?? 0),
    last_transaction_at:
      row.last_transaction_at == null
        ? null
        : new Date(row.last_transaction_at).toISOString(),
  };
}
