/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  normalizeProjectOnboardingIntent,
  onboardingIntentOtherSettings,
  projectOnboardingIntentFromPublicPath,
} from "./onboarding-intent";

describe("onboarding intent", () => {
  it("accepts only supported project intents", () => {
    expect(normalizeProjectOnboardingIntent(" jupyter-python ")).toBe(
      "jupyter-python",
    );
    expect(normalizeProjectOnboardingIntent("license-site")).toBeUndefined();
    expect(normalizeProjectOnboardingIntent("anything")).toBeUndefined();
  });

  it.each([
    ["/features/jupyter-notebook", "jupyter-python"],
    ["/features/python", "jupyter-python"],
    ["/features/r-statistical-software", "jupyter-r"],
    ["/features/julia", "jupyter-julia"],
    ["/features/sage", "sage"],
    ["/features/terminal", "code"],
    ["/features/software-environment", "code"],
    ["/features/latex-editor", "latex"],
    ["/features/teaching", "teaching"],
    ["/features/ai", "codex"],
  ] as const)("maps %s to %s", (path, expected) => {
    expect(projectOnboardingIntentFromPublicPath(path)).toBe(expected);
  });

  it("builds account settings only for a valid intent", () => {
    expect(onboardingIntentOtherSettings("sage")).toEqual({
      first_run_onboarding_intent_v1: "sage",
    });
    expect(onboardingIntentOtherSettings("invalid")).toEqual({});
  });
});
