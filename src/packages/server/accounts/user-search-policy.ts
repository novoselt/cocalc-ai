/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getServerSettings } from "@cocalc/database/settings/server-settings";
import {
  isValidUUID,
  is_valid_email_address as isValidEmailAddress,
  parse_user_search as parseUserSearch,
} from "@cocalc/util/misc";

export const DEFAULT_USER_SEARCH_LIMIT = 20;
export const DEFAULT_USER_SEARCH_MIN_TEXT_LENGTH = 2;
export const HARD_MAX_USER_SEARCH_RESULTS = 50;

export type UserSearchQueryKind = "account_id" | "email" | "text";

export interface ParsedUserSearchQuery {
  normalized: string;
  kind: UserSearchQueryKind;
  account_id?: string;
  email_queries: string[];
  string_queries: string[][];
}

export interface NonAdminUserSearchRequest extends ParsedUserSearchQuery {
  allowed: boolean;
  limit: number;
  minimum_text_length: number;
}

type UserSearchSettings = {
  user_search_min_text_length?: unknown;
  user_search_max_results?: unknown;
};

function boundedInteger(
  value: unknown,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.max(minimum, Math.min(maximum, Math.floor(parsed)));
}

export function parseUserSearchQuery(query: string): ParsedUserSearchQuery {
  const normalized = `${query ?? ""}`.trim().toLowerCase();
  if (isValidUUID(normalized)) {
    return {
      normalized,
      kind: "account_id",
      account_id: normalized,
      email_queries: [],
      string_queries: [],
    };
  }
  if (isValidEmailAddress(normalized)) {
    return {
      normalized,
      kind: "email",
      email_queries: [normalized],
      string_queries: [],
    };
  }
  const { string_queries, email_queries } = parseUserSearch(normalized);
  return {
    normalized,
    kind: "text",
    email_queries: email_queries.map((email) => email.toLowerCase()),
    string_queries,
  };
}

export async function getNonAdminUserSearchRequest({
  query,
  limit,
  settings,
}: {
  query: string;
  limit?: number;
  settings?: UserSearchSettings;
}): Promise<NonAdminUserSearchRequest> {
  const configured = settings ?? (await getServerSettings());
  const minimum_text_length = boundedInteger(
    configured.user_search_min_text_length,
    DEFAULT_USER_SEARCH_MIN_TEXT_LENGTH,
    1,
    20,
  );
  const maximumResults = boundedInteger(
    configured.user_search_max_results,
    HARD_MAX_USER_SEARCH_RESULTS,
    1,
    HARD_MAX_USER_SEARCH_RESULTS,
  );
  const requestedLimit =
    limit == null
      ? DEFAULT_USER_SEARCH_LIMIT
      : boundedInteger(limit, DEFAULT_USER_SEARCH_LIMIT, 0, maximumResults);
  const parsed = parseUserSearchQuery(query);
  return {
    ...parsed,
    allowed:
      parsed.kind !== "text" ||
      (parsed.string_queries
        .flat()
        .every((term) => term.length >= minimum_text_length) &&
        (parsed.string_queries.length > 0 || parsed.email_queries.length > 0)),
    limit: Math.min(requestedLimit, maximumResults),
    minimum_text_length,
  };
}
