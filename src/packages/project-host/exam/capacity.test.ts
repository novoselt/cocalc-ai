/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { validateExamCapacityIncrease } from "./capacity";

describe("exam run capacity", () => {
  it("allows increases and idempotent retries while ready or open", () => {
    expect(() =>
      validateExamCapacityIncrease({
        current: 10,
        requested: 11,
        status: "open",
      }),
    ).not.toThrow();
    expect(() =>
      validateExamCapacityIncrease({
        current: 11,
        requested: 11,
        status: "ready",
      }),
    ).not.toThrow();
  });

  it("rejects decreases, invalid limits, and cleanup states", () => {
    expect(() =>
      validateExamCapacityIncrease({
        current: 10,
        requested: 9,
        status: "open",
      }),
    ).toThrow("cannot decrease");
    expect(() =>
      validateExamCapacityIncrease({
        current: 10,
        requested: 10.5,
        status: "open",
      }),
    ).toThrow("integer between 1 and 1000");
    expect(() =>
      validateExamCapacityIncrease({
        current: 10,
        requested: 11,
        status: "cleaning",
      }),
    ).toThrow("ready or open");
  });
});
