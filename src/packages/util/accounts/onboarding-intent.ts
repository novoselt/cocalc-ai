/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export const PROJECT_ONBOARDING_INTENTS = [
  "jupyter-python",
  "jupyter-r",
  "jupyter-julia",
  "sage",
  "code",
  "codex",
  "latex",
  "teaching",
] as const;

export type ProjectOnboardingIntent =
  (typeof PROJECT_ONBOARDING_INTENTS)[number];

export const FIRST_RUN_ONBOARDING_INTENT_SETTING =
  "first_run_onboarding_intent_v1";

const PROJECT_ONBOARDING_INTENT_SET = new Set<string>(
  PROJECT_ONBOARDING_INTENTS,
);

export function normalizeProjectOnboardingIntent(
  value: unknown,
): ProjectOnboardingIntent | undefined {
  const intent = `${value ?? ""}`.trim().toLowerCase();
  return PROJECT_ONBOARDING_INTENT_SET.has(intent)
    ? (intent as ProjectOnboardingIntent)
    : undefined;
}

export function onboardingIntentOtherSettings(
  intent: unknown,
): Record<string, ProjectOnboardingIntent> {
  const normalized = normalizeProjectOnboardingIntent(intent);
  return normalized
    ? { [FIRST_RUN_ONBOARDING_INTENT_SETTING]: normalized }
    : {};
}

export function projectOnboardingIntentFromPublicPath(
  pathname: unknown,
): ProjectOnboardingIntent | undefined {
  const path = `${pathname ?? ""}`.toLowerCase();
  if (/\/features\/(jupyter-notebook|python)(?:\/|$)/.test(path)) {
    return "jupyter-python";
  }
  if (/\/features\/r-statistical-software(?:\/|$)/.test(path)) {
    return "jupyter-r";
  }
  if (/\/features\/julia(?:\/|$)/.test(path)) return "jupyter-julia";
  if (/\/features\/sage(?:\/|$)/.test(path)) return "sage";
  if (/\/features\/latex-editor(?:\/|$)/.test(path)) return "latex";
  if (/\/features\/teaching(?:\/|$)/.test(path)) return "teaching";
  if (/\/features\/ai(?:\/|$)/.test(path)) return "codex";
  if (
    /\/features\/(linux|terminal|software-environment|octave)(?:\/|$)/.test(
      path,
    )
  ) {
    return "code";
  }
  return undefined;
}
