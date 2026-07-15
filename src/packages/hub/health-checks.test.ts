/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { checkConatRouting } from "./health-checks";

describe("hub readiness checks", () => {
  it("accepts a successful Conat routing round trip", async () => {
    await expect(
      checkConatRouting(async () => ({ now: Date.now() })),
    ).resolves.toEqual({
      status: "conat routing round trip succeeded",
    });
  });

  it("marks a failed Conat routing round trip unhealthy", async () => {
    await expect(
      checkConatRouting(async () => {
        throw Error("route unavailable");
      }),
    ).resolves.toEqual({
      status: "conat routing round trip failed: route unavailable",
      abort: true,
    });
  });
});
