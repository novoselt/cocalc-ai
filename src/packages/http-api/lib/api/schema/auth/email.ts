/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { z } from "@cocalc/http-api/lib/api";

export const EmailAuthChallengeStateSchema = z.enum([
  "pending",
  "email_proved",
  "account_creating",
  "account_ready",
  "mfa_required",
  "completed",
  "superseded",
  "expired",
  "blocked",
  "failed",
]);

export const EmailAuthChallengeStatusSchema = z.object({
  challenge_id: z.string().uuid(),
  state: EmailAuthChallengeStateSchema,
  masked_email: z.string(),
  expires_at: z.string(),
  resend_available_at: z.string(),
  send_count: z.number().int(),
  message_sent: z.boolean(),
  message_failed: z.boolean(),
});

export const EmailAuthErrorSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
});

export const EmailAuthStartInputSchema = z.object({
  email: z.string().email(),
  analytics_token: z.string().uuid().optional(),
});

export const EmailAuthStartOutputSchema = z.union([
  EmailAuthChallengeStatusSchema,
  z.object({
    sso_required: z.literal(true),
    strategy: z.object({
      name: z.string(),
      display: z.string(),
    }),
  }),
  EmailAuthErrorSchema,
]);

export const EmailAuthStatusInputSchema = z.object({
  challenge_id: z.string().uuid(),
});

export const EmailAuthRedeemCodeInputSchema = EmailAuthStatusInputSchema.extend(
  {
    code: z.string().regex(/^\d{6}$/),
  },
);

export const EmailAuthRedeemLinkInputSchema = EmailAuthStatusInputSchema.extend(
  {
    token: z.string().min(32),
  },
);

export const EmailAuthChallengeOutputSchema = z.union([
  EmailAuthChallengeStatusSchema,
  EmailAuthErrorSchema,
]);
