/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  parseLineFromHashFragment,
  parsePathWithOptionalLineSuffix,
} from "./parse-path-line";

describe("linked file line parsing", () => {
  it("parses agent-style line and column suffixes", () => {
    expect(parsePathWithOptionalLineSuffix("/tmp/example.ts:42:7.")).toEqual({
      path: "/tmp/example.ts",
      line: 42,
    });
  });

  it("does not reinterpret directory paths", () => {
    expect(parsePathWithOptionalLineSuffix("/tmp/example/:42")).toEqual({
      path: "/tmp/example/:42",
    });
  });

  it("parses GitHub-style line fragments", () => {
    expect(parseLineFromHashFragment("#L42C7-L48")).toBe(42);
    expect(parseLineFromHashFragment("L9-12")).toBe(9);
  });

  it("rejects unrelated or invalid fragments", () => {
    expect(parseLineFromHashFragment("#section-1")).toBeUndefined();
    expect(parseLineFromHashFragment("#L0")).toBeUndefined();
  });
});
