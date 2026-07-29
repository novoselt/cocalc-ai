/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export type EmailAuthPurpose = "sign_in_or_sign_up";

export type EmailAuthChallengeState =
  | "pending"
  | "email_proved"
  | "account_creating"
  | "account_ready"
  | "mfa_required"
  | "completed"
  | "superseded"
  | "expired"
  | "blocked"
  | "failed";

export interface EmailAuthChallengePublicStatus {
  challenge_id: string;
  state: EmailAuthChallengeState;
  masked_email: string;
  expires_at: string;
  resend_available_at: string;
  send_count: number;
  message_sent: boolean;
  message_failed: boolean;
}

export interface StartEmailAuthChallengeOptions {
  email_address: string;
  browser_binding: string;
  request_ip?: string;
  analytics_token?: string;
  purpose?: EmailAuthPurpose;
}

export interface GetEmailAuthChallengeStatusOptions {
  challenge_id: string;
  browser_binding: string;
}

export interface ResendEmailAuthChallengeOptions extends GetEmailAuthChallengeStatusOptions {}

export interface RedeemEmailAuthCodeOptions {
  challenge_id: string;
  code: string;
  browser_binding?: string;
}

export interface RedeemEmailAuthLinkOptions {
  challenge_id: string;
  token: string;
  browser_binding?: string;
}
