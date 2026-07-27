/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { pii_retention_to_future } from "@cocalc/database/postgres/account/pii";
import type { PostgreSQL } from "@cocalc/database/postgres/types";
import { is_valid_uuid_string } from "@cocalc/util/misc";

export interface AnalyticsRecord {
  accountId?: string;
  data?: object;
}

function sanitize(obj: object, recursive = 0): Record<string, unknown> {
  if (recursive >= 2) return { error: "recursion limit" };
  const ret: Record<string, unknown> = {};
  let count = 0;
  for (const key of Object.keys(obj)) {
    count += 1;
    if (count > 20) break;
    const sanitizedKey = key.slice(0, 50);
    let sanitizedValue = obj[key];
    if (sanitizedValue == null) continue;
    if (typeof sanitizedValue === "object") {
      sanitizedValue = sanitize(sanitizedValue, recursive + 1);
    } else if (typeof sanitizedValue === "string") {
      sanitizedValue = sanitizedValue.slice(0, 2000);
    }
    ret[sanitizedKey] = sanitizedValue;
  }
  return ret;
}

/**
 * Persist first-touch landing data and the first authenticated account link.
 *
 * The two browser requests can arrive in either order. The upsert fills only
 * missing attribution fields, so a retry or later request cannot replace the
 * original landing page or account.
 */
export async function recordAnalyticsData({
  database,
  piiRetention,
  record,
  token,
}: {
  database: PostgreSQL;
  piiRetention: number | false;
  record: AnalyticsRecord;
  token: string;
}): Promise<void> {
  if (!is_valid_uuid_string(token)) return;
  if (record.accountId != null && !is_valid_uuid_string(record.accountId)) {
    return;
  }

  const data = record.data == null ? undefined : sanitize(record.data);
  if (data == null && record.accountId == null) return;

  const now = new Date();
  const expire = pii_retention_to_future(piiRetention);
  await database._pool.query(
    `
      INSERT INTO analytics (
        token,
        data,
        data_time,
        account_id,
        account_id_time,
        expire
      )
      VALUES ($1::UUID, $2::JSONB, $3::TIMESTAMP, $4::UUID, $5::TIMESTAMP, $6::TIMESTAMP)
      ON CONFLICT (token) DO UPDATE SET
        data = COALESCE(analytics.data, EXCLUDED.data),
        data_time = COALESCE(analytics.data_time, EXCLUDED.data_time),
        account_id = COALESCE(analytics.account_id, EXCLUDED.account_id),
        account_id_time = COALESCE(
          analytics.account_id_time,
          EXCLUDED.account_id_time
        ),
        expire = COALESCE(EXCLUDED.expire, analytics.expire)
    `,
    [
      token,
      data == null ? null : JSON.stringify(data),
      data == null ? null : now,
      record.accountId ?? null,
      record.accountId == null ? null : now,
      expire ?? null,
    ],
  );
}
