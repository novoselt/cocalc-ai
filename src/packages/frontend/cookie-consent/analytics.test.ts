/** @jest-environment jsdom */

import {
  linkFirstPartyAnalyticsAccount,
  loadFirstPartyAnalytics,
} from "./analytics";

const acceptedCategory = jest.fn(() => false);

jest.mock("vanilla-cookieconsent", () => ({
  acceptedCategory: (...args: unknown[]) => acceptedCategory(...args),
}));

describe("first-party analytics consent", () => {
  beforeEach(() => {
    acceptedCategory.mockReset();
    acceptedCategory.mockReturnValue(false);
    document.head.innerHTML = "";
    window.fetch = jest.fn();
  });

  it("does not load without analytics consent", async () => {
    await expect(loadFirstPartyAnalytics()).resolves.toBe(false);
    expect(document.querySelector("script")).toBeNull();
  });

  it("loads once and links without sending a browser account id", async () => {
    acceptedCategory.mockReturnValue(true);
    const fetch = window.fetch as jest.Mock;
    fetch.mockResolvedValue({ ok: true });

    const loaded = loadFirstPartyAnalytics();
    const script = document.getElementById(
      "cocalc-first-party-analytics",
    ) as HTMLScriptElement;
    expect(script.src).toContain("/analytics.js?fqd=false");
    script.dispatchEvent(new Event("load"));
    await expect(loaded).resolves.toBe(true);

    await linkFirstPartyAnalyticsAccount();
    expect(
      document.querySelectorAll("#cocalc-first-party-analytics"),
    ).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith(
      "/analytics.js",
      expect.objectContaining({
        body: JSON.stringify({ account_link: true }),
        credentials: "include",
        method: "POST",
      }),
    );
  });
});
