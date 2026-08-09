/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { CodexPaymentSourceInfo } from "@cocalc/conat/hub/api/system";

export function codexAvailableForOnboarding(
  paymentSource?: CodexPaymentSourceInfo,
): boolean {
  if (!paymentSource) return false;
  if (paymentSource.hasSubscription || paymentSource.hasAccountApiKey) {
    return true;
  }
  if (paymentSource.source === "shared-home") return true;
  return (
    paymentSource.hasSiteApiKey &&
    paymentSource.siteFundedCodex?.enabled === true &&
    paymentSource.siteAiUsageLimitPositive === true
  );
}

export function codexOnboardingFundingDescription(
  paymentSource?: CodexPaymentSourceInfo,
): string {
  if (paymentSource?.hasSubscription) {
    return "Uses your connected ChatGPT plan. CoCalc will not charge you per prompt.";
  }
  if (paymentSource?.hasAccountApiKey) {
    return "Uses your personal OpenAI API key. CoCalc will not add per-prompt charges.";
  }
  if (paymentSource?.source === "shared-home") {
    return "Uses this site's shared Codex access. CoCalc will not charge you per prompt.";
  }
  return "Included with your CoCalc membership. There are no per-prompt CoCalc charges.";
}
