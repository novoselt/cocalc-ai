/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { abspathForPlatform } from "./abspath";
import ensureContainingDirectoryExists from "./ensure-containing-directory-exists";

describe("backend filesystem paths", () => {
  it("recognizes Windows drive paths and resolves relative paths", () => {
    const options = { home: "C:\\Users\\Ada", platform: "win32" as const };
    expect(abspathForPlatform("D:\\CoCalc\\data.db", options)).toBe(
      "D:\\CoCalc\\data.db",
    );
    expect(abspathForPlatform("sync\\account\\state.db", options)).toBe(
      "C:\\Users\\Ada\\sync\\account\\state.db",
    );
  });

  it("creates every containing directory for a database path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "cocalc-parent-dir-"));
    try {
      const filename = path.join(root, "sync", "account", "state.db");
      await ensureContainingDirectoryExists(filename);
      await expect(stat(path.dirname(filename))).resolves.toMatchObject({});
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
