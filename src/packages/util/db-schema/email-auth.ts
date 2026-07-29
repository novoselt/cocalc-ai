/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Table } from "./types";

Table({
  name: "email_auth_challenges",
  rules: {
    primary_key: "challenge_id",
    durability: "soft",
    pg_indexes: [
      "email_lookup_hash",
      "account_id",
      "state",
      "expires_at",
      "created_at",
      "analytics_token",
    ],
  },
  fields: {
    challenge_id: {
      type: "uuid",
      desc: "Seed-global email authentication challenge identifier.",
    },
    normalized_email: {
      type: "string",
      pg_type: "varchar(254)",
      desc: "Short-lived normalized destination email address.",
    },
    email_lookup_hash: {
      type: "string",
      pg_type: "char(64)",
      desc: "Keyed lookup digest for rate limiting and diagnostics.",
    },
    account_id: {
      type: "uuid",
      desc: "Resolved account, if the email already belongs to an account.",
    },
    selected_home_bay_id: {
      type: "string",
      pg_type: "varchar(64)",
      desc: "Existing or selected account home bay.",
    },
    exchange_id: {
      type: "uuid",
      desc: "Single-use home-bay session exchange identifier.",
    },
    auth_method: {
      type: "string",
      pg_type: "varchar(32)",
      desc: "Successful proof method, such as email_code or email_link.",
    },
    purpose: {
      type: "string",
      pg_type: "varchar(32)",
      desc: "Challenge purpose, initially sign_in_or_sign_up.",
    },
    state: {
      type: "string",
      pg_type: "varchar(32)",
      desc: "Explicit email authentication lifecycle state.",
    },
    code_digest: {
      type: "string",
      pg_type: "char(64)",
      desc: "Keyed digest of the six-digit code.",
    },
    link_token_digest: {
      type: "string",
      pg_type: "char(64)",
      desc: "Keyed digest of the magic-link token.",
    },
    browser_binding_digest: {
      type: "string",
      pg_type: "char(64)",
      desc: "Keyed digest of the essential browser-flow nonce.",
    },
    analytics_token: {
      type: "uuid",
      desc: "Optional signup attribution token.",
    },
    terms_accepted_at: {
      type: "timestamp",
      desc: "Terms acceptance associated with a potential new account.",
    },
    terms_version: {
      type: "string",
      desc: "Terms version associated with acceptance.",
    },
    registration_token_reservation_id: {
      type: "uuid",
      desc: "Opaque reservation for token-gated account creation.",
    },
    continuation: {
      type: "map",
      desc: "Validated same-site authentication continuation.",
    },
    attempt_count: {
      type: "integer",
      desc: "Failed code or link redemption attempts.",
    },
    max_attempts: {
      type: "integer",
      desc: "Maximum failed redemptions before blocking.",
    },
    send_count: {
      type: "integer",
      desc: "Number of messages sent for this challenge.",
    },
    resend_available_at: {
      type: "timestamp",
      desc: "Earliest allowed resend time.",
    },
    message_queued_at: {
      type: "timestamp",
      desc: "When delivery was requested.",
    },
    message_sent_at: {
      type: "timestamp",
      desc: "When the configured email backend accepted the message.",
    },
    message_failed_at: {
      type: "timestamp",
      desc: "When the latest delivery attempt failed.",
    },
    message_error_code: {
      type: "string",
      pg_type: "varchar(64)",
      desc: "Sanitized delivery error class, never a raw provider response.",
    },
    first_viewed_at: {
      type: "timestamp",
      desc: "When the bound browser first requested challenge status.",
    },
    email_proved_at: {
      type: "timestamp",
      desc: "When code or link proof succeeded.",
    },
    account_created_at: {
      type: "timestamp",
      desc: "When successful proof resulted in account creation.",
    },
    session_completed_at: {
      type: "timestamp",
      desc: "When a browser session was established.",
    },
    expires_at: {
      type: "timestamp",
      desc: "Challenge expiration time.",
    },
    completed_at: {
      type: "timestamp",
      desc: "When the complete account/session flow finishes.",
    },
    superseded_at: {
      type: "timestamp",
      desc: "When a newer challenge replaced this challenge.",
    },
    created_at: {
      type: "timestamp",
      desc: "Challenge creation time.",
    },
    updated_at: {
      type: "timestamp",
      desc: "Last lifecycle update.",
    },
    request_ip_hash: {
      type: "string",
      pg_type: "char(64)",
      desc: "Keyed request-address digest for abuse controls.",
    },
    metadata: {
      type: "map",
      desc: "Non-secret flow and delivery metadata.",
    },
  },
});
