/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export const EMAIL_AUTHENTICATION_MODES = [
  "password_required",
  "verify_after_signup",
  "email_first",
] as const;

export type EmailAuthenticationMode =
  (typeof EMAIL_AUTHENTICATION_MODES)[number];

export function normalizeEmailAuthenticationMode(
  value: unknown,
): EmailAuthenticationMode {
  return EMAIL_AUTHENTICATION_MODES.includes(value as EmailAuthenticationMode)
    ? (value as EmailAuthenticationMode)
    : "password_required";
}
