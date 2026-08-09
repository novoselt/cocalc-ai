import type { CodexPaymentSourceInfo } from "@cocalc/conat/hub/api/system";
import {
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
