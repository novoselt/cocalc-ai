/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  getNonAdminUserSearchRequest,
  parseUserSearchQuery,
} from "./user-search-policy";

describe("non-admin user search policy", () => {
  it("allows short and SQL wildcard text terms", async () => {
    for (const query of ["a", "a,", "a;", "%%", "__"]) {
      await expect(
        getNonAdminUserSearchRequest({
          query,
          settings: { user_search_max_results: 50 },
        }),
      ).resolves.toMatchObject({
        kind: "text",
        limit: 20,
      });
    }
  });

  it("clamps configurable and requested result limits to the hard maximum", async () => {
    await expect(
      getNonAdminUserSearchRequest({
        query: "Ada",
        limit: 500,
        settings: {
          user_search_max_results: 500,
        },
      }),
    ).resolves.toMatchObject({
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
