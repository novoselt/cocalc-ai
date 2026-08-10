import type { CodexPaymentSourceInfo } from "@cocalc/conat/hub/api/system";
import {
  buildCodexOnboardingPrompt,
  codexAvailableForOnboarding,
  codexOnboardingFundingDescription,
} from "./codex";

function source(
  value: Partial<CodexPaymentSourceInfo>,
): CodexPaymentSourceInfo {
  return {
    source: "none",
    hasSubscription: false,
    hasProjectApiKey: false,
    hasAccountApiKey: false,
    hasSiteApiKey: false,
    sharedHomeMode: "disabled",
    ...value,
  };
}

describe("Codex onboarding availability", () => {
  it("turns a first-project goal into an action-oriented hidden prompt", () => {
    const prompt = buildCodexOnboardingPrompt(
      "  See benchmarks of some basic number theory algorithms.  ",
    );

    expect(prompt).toContain(
      "<user_goal>\nSee benchmarks of some basic number theory algorithms.\n</user_goal>",
    );
    expect(prompt).toContain("project was just created");
    expect(prompt).toContain("Prefer a runnable Jupyter notebook");
    expect(prompt).toContain("Actually run or otherwise validate");
    expect(prompt).toContain("Do not search browser tabs");
    expect(prompt).toContain("Begin by creating the deliverable");
  });

  it.each<[string, string, boolean]>([
    ["Write my first LaTeX paper with BibTeX", "compile-ready LaTeX", true],
    ["Teach me Linux terminal commands", "terminal-first workflow", true],
    ["Build a small TypeScript app", "appropriate source files", true],
    ["Help me organize my research ideas", "best fits", false],
  ])(
    "uses request-specific guidance for %s",
    (request, expected, excludesNotebook) => {
      const prompt = buildCodexOnboardingPrompt(request);
      expect(prompt).toContain(expected);
      if (excludesNotebook) {
        expect(prompt).toContain("Do not create a notebook");
      } else {
        expect(prompt).not.toContain("Prefer a runnable Jupyter notebook");
      }
    },
  );

  it("requires both a positive allowance and enabled site funding", () => {
    expect(
      codexAvailableForOnboarding(
        source({
          source: "site-api-key",
          hasSiteApiKey: true,
          siteAiUsageLimitPositive: false,
          siteFundedCodex: { enabled: true },
        }),
      ),
    ).toBe(false);
    expect(
      codexAvailableForOnboarding(
        source({
          source: "site-api-key",
          hasSiteApiKey: true,
          siteAiUsageLimitPositive: true,
          siteFundedCodex: { enabled: true },
        }),
      ),
    ).toBe(true);
  });

  it("allows connected personal sources without site funding", () => {
    expect(
      codexAvailableForOnboarding(
        source({ source: "subscription", hasSubscription: true }),
      ),
    ).toBe(true);
    expect(
      codexAvailableForOnboarding(
        source({ source: "account-api-key", hasAccountApiKey: true }),
      ),
    ).toBe(true);
  });

  it("makes the absence of per-prompt CoCalc charges explicit", () => {
    expect(
      codexOnboardingFundingDescription(
        source({ source: "subscription", hasSubscription: true }),
      ),
    ).toContain("will not charge you per prompt");
    expect(
      codexOnboardingFundingDescription(
        source({ source: "site-api-key", hasSiteApiKey: true }),
      ),
    ).toContain("no per-prompt CoCalc charges");
  });
});
