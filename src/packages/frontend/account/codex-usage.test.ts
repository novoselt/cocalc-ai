import { getCodexSubscriptionConnection } from "./codex-usage";

describe("getCodexSubscriptionConnection", () => {
  it("uses an explicit backend authentication result", () => {
    expect(
      getCodexSubscriptionConnection({
        available: false,
        checkedAt: new Date().toISOString(),
        paymentSource: { source: "subscription" } as any,
        authentication: {
          status: "needs-sign-in",
          reason: "Sign in again.",
        },
      }),
    ).toEqual({ status: "needs-sign-in", reason: "Sign in again." });
  });

  it("treats a verified account as connected when usage is unavailable", () => {
    expect(
      getCodexSubscriptionConnection({
        available: false,
        checkedAt: new Date().toISOString(),
        paymentSource: { source: "subscription" } as any,
        account: {
          account: {
            type: "chatgpt",
            email: "user@example.com",
          },
        },
        errors: { rateLimits: "rate limit service unavailable" },
      }),
    ).toEqual({ status: "connected" });
  });

  it("recognizes auth failures returned by older project hosts", () => {
    expect(
      getCodexSubscriptionConnection({
        available: false,
        checkedAt: new Date().toISOString(),
        paymentSource: { source: "subscription" } as any,
        reason: "codex account authentication required to read rate limits",
      }).status,
    ).toBe("needs-sign-in");
  });
});
