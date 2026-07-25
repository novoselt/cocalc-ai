/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  getNonAdminUserSearchRequest,
  parseUserSearchQuery,
} from "./user-search-policy";

describe("non-admin user search policy", () => {
  it("requires the configured minimum for text searches", async () => {
    const settings = {
      user_search_min_text_length: 2,
      user_search_max_results: 50,
    };
    for (const query of ["a", "a,", "a;"]) {
      await expect(
        getNonAdminUserSearchRequest({ query, settings }),
      ).resolves.toMatchObject({
        allowed: false,
        kind: "text",
        minimum_text_length: 2,
      });
    }
  });

  it("does not apply the text minimum to exact email or account-id searches", async () => {
    const settings = {
      user_search_min_text_length: 20,
      user_search_max_results: 50,
    };
    await expect(
      getNonAdminUserSearchRequest({
        query: "ada@example.edu",
        settings,
      }),
    ).resolves.toMatchObject({ allowed: true, kind: "email" });
    await expect(
      getNonAdminUserSearchRequest({
        query: "11111111-1111-4111-8111-111111111111",
        settings,
      }),
    ).resolves.toMatchObject({ allowed: true, kind: "account_id" });
  });

  it("clamps configurable and requested result limits to the hard maximum", async () => {
    await expect(
      getNonAdminUserSearchRequest({
        query: "Ada",
        limit: 500,
        settings: {
          user_search_min_text_length: 2,
          user_search_max_results: 500,
        },
      }),
    ).resolves.toMatchObject({
      allowed: true,
      limit: 50,
    });
  });

  it("uses the same parsed mechanics for name, email, and account-id queries", () => {
    expect(parseUserSearchQuery("Ada Lovelace")).toMatchObject({
      kind: "text",
      normalized: "ada lovelace",
      string_queries: [["ada", "lovelace"]],
    });
    expect(parseUserSearchQuery("ADA@EXAMPLE.EDU")).toMatchObject({
      kind: "email",
      email_queries: ["ada@example.edu"],
    });
    expect(
      parseUserSearchQuery("11111111-1111-4111-8111-111111111111"),
    ).toMatchObject({
      kind: "account_id",
      account_id: "11111111-1111-4111-8111-111111111111",
    });
  });
});
