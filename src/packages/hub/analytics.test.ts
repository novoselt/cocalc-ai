/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { normalizeAnalyticsPostPayload } from "./analytics-payload";

describe("normalizeAnalyticsPostPayload", () => {
  it("keeps safe landing attribution but strips account and unknown fields", () => {
    expect(
      normalizeAnalyticsPostPayload({
        landing: "https://cocalc.ai/features/sage",
        referrer: "https://www.google.com/search?q=private",
        arbitrary: "not part of the analytics schema",
        account_id: "attacker-controlled",
        account_link: true,
      }),
    ).toEqual({
      landing: "https://cocalc.ai/features/sage",
      referrer: "https://www.google.com/",
    });
  });

  it("redacts authenticated paths, tokens, filenames, and URL components", () => {
    expect(
      normalizeAnalyticsPostPayload({
        landing:
          "https://user:password@cocalc.ai/projects/project-id/files/secret.tex?token=secret#fragment",
        referrer:
          "https://search.example/private/path?q=person@example.com#fragment",
      }),
    ).toEqual({
      landing: "https://cocalc.ai/projects/*",
      referrer: "https://search.example/",
    });
    expect(
      normalizeAnalyticsPostPayload({
        landing: "https://cocalc.ai/auth/verify/b163nsfftshinxl0",
      }),
    ).toEqual({
      landing: "https://cocalc.ai/auth/*",
    });
  });

  it("retains mobile app referrer identity without its path", () => {
    expect(
      normalizeAnalyticsPostPayload({
        landing: "https://cocalc.ai/",
        referrer:
          "android-app://com.google.android.googlequicksearchbox/private/search",
      }),
    ).toEqual({
      landing: "https://cocalc.ai/",
      referrer: "android-app://com.google.android.googlequicksearchbox/",
    });
  });

  it("coarsens unknown routes and preserves only curated public slugs", () => {
    expect(
      normalizeAnalyticsPostPayload({
        landing: "https://cocalc.ai/features/jupyter-notebook",
      }),
    ).toEqual({
      landing: "https://cocalc.ai/features/jupyter-notebook",
    });
    expect(
      normalizeAnalyticsPostPayload({
        landing: "https://cocalc.ai/custom/private/value",
      }),
    ).toEqual({
      landing: "https://cocalc.ai/custom/*",
    });
    expect(
      normalizeAnalyticsPostPayload({
        landing:
          "https://cocalc.ai/2421ddd1-1dee-4b72-8a98-b844d24f09b9/files/private",
      }),
    ).toEqual({
      landing: "https://cocalc.ai/*",
    });
  });

  it("allowlists and bounds UTM values", () => {
    expect(
      normalizeAnalyticsPostPayload({
        utm: {
          source: "newsletter",
          campaign: "x".repeat(250),
          injected: "secret",
          term: 123,
        },
      }),
    ).toEqual({
      utm: {
        source: "newsletter",
        campaign: "x".repeat(200),
      },
    });
  });

  it("rejects invalid URLs and empty attribution", () => {
    expect(
      normalizeAnalyticsPostPayload({
        landing: "javascript:alert(1)",
        referrer: "not a URL",
        account_id: "attacker-controlled",
      }),
    ).toBeUndefined();
  });

  it("rejects non-object payloads", () => {
    expect(normalizeAnalyticsPostPayload(null)).toBeUndefined();
    expect(normalizeAnalyticsPostPayload("landing")).toBeUndefined();
    expect(normalizeAnalyticsPostPayload([])).toBeUndefined();
  });
});
