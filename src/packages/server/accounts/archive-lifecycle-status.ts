/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { AccountLocalArchiveLifecycleStatus } from "@cocalc/conat/inter-bay/api";
import getPool from "@cocalc/database/pool";
import { ensureAccountBanTimestampSchema } from "@cocalc/server/accounts/ban-timestamp";
import { resolveMembershipForAccount } from "@cocalc/server/membership/resolve";
import { isValidUUID } from "@cocalc/util/misc";

const MAX_BATCH = 500;

export async function getArchiveLifecycleAccountStatusesLocal({
  account_ids,
}: {
  account_ids: string[];
}): Promise<AccountLocalArchiveLifecycleStatus[]> {
  const ids = [...new Set(account_ids.map((id) => `${id}`.trim()))];
  if (ids.length > MAX_BATCH) {
    throw new Error(`at most ${MAX_BATCH} account ids may be resolved at once`);
  }
  if (ids.some((id) => !isValidUUID(id))) {
    throw new Error("every account_id must be a valid uuid");
  }
  if (ids.length === 0) return [];

  await ensureAccountBanTimestampSchema();
  const { rows } = await getPool().query<{
    account_id: string;
    banned: boolean | null;
    banned_at: Date | string | null;
    deleted: boolean | null;
  }>(
    `SELECT account_id, banned, banned_at, deleted
       FROM accounts
      WHERE account_id = ANY($1::uuid[])`,
    [ids],
  );
  const accounts = new Map(rows.map((row) => [row.account_id, row]));
  return await Promise.all(
    ids.map(async (account_id): Promise<AccountLocalArchiveLifecycleStatus> => {
      const account = accounts.get(account_id);
      if (!account || account.deleted === true) {
        return {
          account_id,
          resolved: false,
          banned: false,
          banned_at: null,
          membership: null,
        };
      }
      try {
        return {
          account_id,
          resolved: true,
          banned: account.banned === true,
          banned_at: account.banned_at
            ? new Date(account.banned_at).toISOString()
            : null,
          membership: await resolveMembershipForAccount(account_id),
        };
      } catch {
        return {
          account_id,
          resolved: true,
          banned: account.banned === true,
          banned_at: account.banned_at
            ? new Date(account.banned_at).toISOString()
            : null,
          membership: null,
        };
      }
    }),
  );
}
