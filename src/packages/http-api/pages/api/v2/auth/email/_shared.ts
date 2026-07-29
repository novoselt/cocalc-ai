/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getServerSettings } from "@cocalc/database/settings/server-settings";
import { createEmailAuthBrowserBinding } from "@cocalc/server/auth/email/secrets";
import { EmailAuthChallengeError } from "@cocalc/server/auth/email/challenge-store";
import { isEmailConfigured } from "@cocalc/server/email/send-email";
import { normalizeEmailAuthenticationMode } from "@cocalc/util/auth/email-auth";

export const EMAIL_AUTH_FLOW_COOKIE = "cocalc_email_auth_flow";
const EMAIL_AUTH_COOKIE_MAX_AGE_SECONDS = 15 * 60;

function parseCookieHeader(header: string | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const part of `${header ?? ""}`.split(";")) {
    const separator = part.indexOf("=");
    if (separator <= 0) continue;
    const name = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (name) result[name] = decodeURIComponent(value);
  }
  return result;
}

export function getEmailAuthBrowserBinding(req): string | undefined {
  return (
    `${req.cookies?.[EMAIL_AUTH_FLOW_COOKIE] ?? ""}`.trim() ||
    parseCookieHeader(req.headers?.cookie)[EMAIL_AUTH_FLOW_COOKIE]
  );
}

export function getOrSetEmailAuthBrowserBinding(req, res): string {
  const existing = getEmailAuthBrowserBinding(req);
  if (existing) {
    return existing;
  }
  const binding = createEmailAuthBrowserBinding();
  const secure =
    `${req.headers?.["x-forwarded-proto"] ?? req.protocol ?? ""}`
      .toLowerCase()
      .split(",")[0]
      .trim() === "https";
  const cookie = [
    `${EMAIL_AUTH_FLOW_COOKIE}=${encodeURIComponent(binding)}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    `Max-Age=${EMAIL_AUTH_COOKIE_MAX_AGE_SECONDS}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
  res.setHeader("Set-Cookie", cookie);
  return binding;
}

export async function assertEmailAuthStartEnabled(): Promise<void> {
  const settings = await getServerSettings();
  if (
    normalizeEmailAuthenticationMode(settings.email_authentication_mode) !==
      "email_first" ||
    settings.email_enabled !== true ||
    settings.verify_emails !== true ||
    !(await isEmailConfigured("critical"))
  ) {
    throw new Error("Email sign-in is not enabled for this site.");
  }
}

export function emailAuthErrorPayload(err: unknown): {
  error: string;
  code?: string;
} {
  if (err instanceof EmailAuthChallengeError) {
    return { error: err.message, code: err.code };
  }
  return {
    error: err instanceof Error ? err.message : "Email sign-in failed.",
  };
}

export function requireEmailAuthBrowserBinding(req): string {
  const binding = getEmailAuthBrowserBinding(req);
  if (!binding) {
    throw new EmailAuthChallengeError(
      "This email sign-in flow is not available in this browser.",
      "not_found",
    );
  }
  return binding;
}
