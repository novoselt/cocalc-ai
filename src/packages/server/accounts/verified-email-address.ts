/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool, { type PoolClient } from "@cocalc/database/pool";

type Queryable = PoolClient | ReturnType<typeof getPool>;

export function verifiedEmailAddressSql({
  email_address = "email_address",
  email_address_verified = "email_address_verified",
}: {
  email_address?: string;
  email_address_verified?: string;
} = {}): string {
  return `
    ${email_address_verified} ? ${email_address}
    AND ${email_address_verified}->${email_address}
          NOT IN ('null'::jsonb, 'false'::jsonb)
  `;
}

export async function getVerifiedEmailAddressForAccount({
  account_id,
  client,
}: {
  account_id: string;
  client?: Queryable;
}): Promise<string | undefined> {
  const { rows } = await (client ?? getPool()).query<{
    email_address: string;
    verified: boolean | null;
  }>(
    `SELECT email_address, (${verifiedEmailAddressSql()}) AS verified
       FROM accounts
      WHERE account_id=$1`,
    [account_id],
  );
  if (rows.length === 0) {
    throw Error("account not found");
  }
  if (rows[0].verified !== true) {
    return;
  }
  const emailAddress = `${rows[0]?.email_address ?? ""}`.trim().toLowerCase();
  return emailAddress || undefined;
}
