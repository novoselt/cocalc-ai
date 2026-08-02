/** @jest-environment jsdom */

jest.mock("@cocalc/frontend/lite", () => ({ lite: false }));

import {
  getCodexPaymentSourceOptions,
  getCodexPaymentSourceTooltip,
} from "../use-codex-payment-source";

describe("Codex payment source choices", () => {
  const available = {
    source: "subscription" as const,
    preference: "auto" as const,
    hasSubscription: true,
    hasProjectApiKey: false,
    hasAccountApiKey: false,
    hasSiteApiKey: true,
    siteAiUsageLimitPositive: true,
    siteFundedCodex: { enabled: true },
    sharedHomeMode: "disabled" as const,
  };

  it("offers included usage even when a ChatGPT credential takes precedence", () => {
    const options = getCodexPaymentSourceOptions(available);
    expect(options).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: "auto" }),
        expect.objectContaining({
          value: "site-api-key",
          disabled: false,
        }),
        expect.objectContaining({ value: "subscription" }),
      ]),
    );
  });

  it("disables included usage when the site-funded policy is unavailable", () => {
    const options = getCodexPaymentSourceOptions({
      ...available,
      siteFundedCodex: { enabled: false },
    });
    expect(options.find(({ value }) => value === "site-api-key")).toEqual(
      expect.objectContaining({ disabled: true }),
    );
  });

  it("only describes precedence for automatic selection", () => {
    expect(getCodexPaymentSourceTooltip(available)).toContain(
      "Automatic order",
    );
    expect(
      getCodexPaymentSourceTooltip({
        ...available,
        source: "site-api-key",
        preference: "site-api-key",
      }),
    ).not.toContain("Automatic order");
  });
});
