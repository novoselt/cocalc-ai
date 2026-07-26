/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { normalizeAnalyticsPostPayload } from "./analytics-payload";

describe("normalizeAnalyticsPostPayload", () => {
  it("keeps landing attribution but strips account fields", () => {
    expect(
      normalizeAnalyticsPostPayload({
        landing: "https://cocalc.ai/features/sage",
        referrer: "https://www.google.com/",
        account_id: "attacker-controlled",
        account_link: true,
      }),
    ).toEqual({
      landing: "https://cocalc.ai/features/sage",
      referrer: "https://www.google.com/",
    });
  });

  it("rejects non-object payloads", () => {
    expect(normalizeAnalyticsPostPayload(null)).toBeUndefined();
    expect(normalizeAnalyticsPostPayload("landing")).toBeUndefined();
    expect(normalizeAnalyticsPostPayload([])).toBeUndefined();
  });
});
