/*
 * This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import { readFileSync } from "node:fs";
import path from "node:path";

describe("project-host changefeed boundary", () => {
  it("does not start the single-user Lite database-table changefeed", () => {
    const source = readFileSync(path.join(__dirname, "main.ts"), "utf8");

    expect(source).not.toMatch(
      /from\s+["']@cocalc\/lite\/hub\/changefeeds["']/,
    );
    expect(source).not.toMatch(
      /require\s*\(\s*["']@cocalc\/lite\/hub\/changefeeds["']\s*\)/,
    );
    expect(source).not.toMatch(
      /import\s*\(\s*["']@cocalc\/lite\/hub\/changefeeds["']\s*\)/,
    );
    expect(source).not.toMatch(/\binitChangefeeds\s*\(/);
  });
});
