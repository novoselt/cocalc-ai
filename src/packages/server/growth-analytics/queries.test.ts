/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { __test__ } from "./queries";

describe("growth analytics query boundaries", () => {
  it("defaults to the canonical project engagement signal", () => {
    const range = __test__.normalizeRange({
      start: "2026-08-01T00:00:00.000Z",
      end: "2026-08-09T00:00:00.000Z",
    });
    expect(range.activity_signal).toBe("project_engaged_v1");
  });

  it("rejects unbounded dashboard ranges", () => {
    expect(() =>
      __test__.normalizeRange({
        start: "2020-01-01T00:00:00.000Z",
        end: "2026-08-09T00:00:00.000Z",
      }),
    ).toThrow("limited to 730 days");
  });

  it("uses null for undefined conversion rates", () => {
    expect(__test__.percent(0, 0)).toBeNull();
    expect(__test__.percent(1, 3)).toBe(33.3);
  });
});
