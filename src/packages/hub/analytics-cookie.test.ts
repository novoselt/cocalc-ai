/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { setAnalyticsCookie } from "./analytics-cookie";

const TOKEN = "ac37d314-6199-4786-97eb-206177807727";

describe("setAnalyticsCookie", () => {
  it("returns the exact token written to the response", () => {
    const cookie = jest.fn();

    expect(setAnalyticsCookie({ cookie }, TOKEN)).toBe(TOKEN);
    expect(cookie).toHaveBeenCalledWith(
      "CC_ANA",
      TOKEN,
      expect.objectContaining({
        maxAge: 7 * 24 * 60 * 60 * 1_000,
        path: "/",
      }),
    );
  });
});
