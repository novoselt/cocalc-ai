/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { PublicSharePublisherProfile } from "@cocalc/conat/hub/api/public-directory-shares";
import getPool from "@cocalc/database/pool";
import { isValidUUID } from "@cocalc/util/misc";
import { MAX_PUBLIC_SHARE_READER_INSTRUCTIONS_LENGTH } from "@cocalc/util/public-directory-share-labels";

const PROFILE_KEY = "public_share_publisher_profile";

export function normalizePublicShareReaderInstructions(
  value: string | null | undefined,
): string | null {
  const normalized = `${value ?? ""}`.trim();
  if (!normalized) return null;
  if (normalized.length > MAX_PUBLIC_SHARE_READER_INSTRUCTIONS_LENGTH) {
    throw Error(
      `reader instructions must be at most ${MAX_PUBLIC_SHARE_READER_INSTRUCTIONS_LENGTH.toLocaleString()} characters`,
    );
  }
  return normalized;
}

function parseProfile(value: unknown): PublicSharePublisherProfile {
  if (value == null || typeof value !== "object") return {};
  const profile = value as Record<string, unknown>;
  const instructions = `${profile.reader_instructions_markdown ?? ""}`.trim();
  const updatedAt = `${profile.updated_at ?? ""}`.trim();
  return {
    reader_instructions_markdown: instructions || null,
    updated_at: updatedAt || null,
  };
}

export async function getPublicSharePublisherProfileLocal({
  account_id,
}: {
  account_id: string;
}): Promise<PublicSharePublisherProfile> {
  if (!isValidUUID(account_id)) throw Error("invalid account_id");
  const { rows } = await getPool().query<{ profile: unknown }>(
    `SELECT other_settings -> $2::text AS profile
       FROM accounts
      WHERE account_id=$1
      LIMIT 1`,
    [account_id, PROFILE_KEY],
  );
  if (rows[0] == null) throw Error("account not found");
  return parseProfile(rows[0].profile);
}

export async function updatePublicSharePublisherProfileLocal({
  account_id,
  reader_instructions_markdown,
}: {
  account_id: string;
  reader_instructions_markdown?: string | null;
}): Promise<PublicSharePublisherProfile> {
  if (!isValidUUID(account_id)) throw Error("invalid account_id");
  const instructions = normalizePublicShareReaderInstructions(
    reader_instructions_markdown,
  );
  const profile: PublicSharePublisherProfile = instructions
    ? {
        reader_instructions_markdown: instructions,
        updated_at: new Date().toISOString(),
      }
    : {};
  const { rowCount } = await getPool().query(
    instructions
      ? `UPDATE accounts
            SET other_settings=jsonb_set(
              COALESCE(other_settings, '{}'::jsonb),
              ARRAY[$2::text],
              $3::jsonb,
              TRUE
            )
          WHERE account_id=$1`
      : `UPDATE accounts
            SET other_settings=COALESCE(other_settings, '{}'::jsonb) - $2::text
          WHERE account_id=$1`,
    instructions
      ? [account_id, PROFILE_KEY, JSON.stringify(profile)]
      : [account_id, PROFILE_KEY],
  );
  if (!rowCount) throw Error("account not found");
  return profile;
}
