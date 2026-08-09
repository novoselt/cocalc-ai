/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { CodexPaymentSourceInfo } from "@cocalc/conat/hub/api/system";

export function buildCodexOnboardingPrompt(userRequest: string): string {
  const goal = userRequest.trim();
  return `You are helping a brand-new CoCalc user complete their first useful task.

This project was just created by the onboarding flow and is intentionally empty. Work directly in /home/user. Treat the user's goal below as a request to create a useful result, not as a request to locate files that should already exist.

<user_goal>
${goal}
</user_goal>

Complete the goal autonomously and make the first experience successful:

- Create a small, concrete, polished deliverable in /home/user that directly addresses the goal.
- For mathematics, data, science, visualization, or computational exploration, prefer a runnable Jupyter notebook unless another format is clearly better. For software tasks, create the appropriate source files and a short README when useful.
- If data or exact requirements are missing, use a clearly labeled, representative example and reasonable defaults. Do not stop merely to ask for clarification when a useful first version can be made.
- Actually run or otherwise validate what you create, inspect the result, and fix obvious errors.
- Keep the scope focused enough to finish during this onboarding turn. Favor a working demonstration that the user can extend over a broad unfinished scaffold.
- Do not search browser tabs, inspect account or project metadata, or use CoCalc CLI discovery commands. The empty workspace is expected; there is no preexisting material to find unless the user explicitly says otherwise.
- Finish with a concise explanation of what you created, the exact filenames to open, and one or two useful next steps.

Begin by creating the deliverable rather than investigating the empty project.`;
}

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
