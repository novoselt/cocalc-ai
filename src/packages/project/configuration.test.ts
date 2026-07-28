/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { mkdir, mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { get_homeDirectory } from "./configuration";

describe("project home directory capabilities", () => {
  const originalHome = process.env.HOME;
  const originalRuntimeHome = process.env.COCALC_RUNTIME_HOME;

  afterEach(() => {
    if (originalHome == null) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }
    if (originalRuntimeHome == null) {
      delete process.env.COCALC_RUNTIME_HOME;
    } else {
      process.env.COCALC_RUNTIME_HOME = originalRuntimeHome;
    }
  });

  it("advertises the canonical runtime home instead of the host workspace home", async () => {
    process.env.HOME =
      "/host/workspace/data/projects/11111111-1111-4111-8111-111111111111";
    process.env.COCALC_RUNTIME_HOME = "/home/user/";

    await expect(get_homeDirectory()).resolves.toBe("/home/user");
  });

  it("resolves HOME symlinks when no runtime home override is configured", async () => {
    const root = await mkdtemp(join(tmpdir(), "cocalc-project-home-"));
    const home = join(root, "home");
    const alias = join(root, "alias");
    try {
      await mkdir(home);
      await symlink(home, alias);
      process.env.HOME = alias;
      delete process.env.COCALC_RUNTIME_HOME;

      await expect(get_homeDirectory()).resolves.toBe(await realpath(alias));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects a relative runtime home", async () => {
    process.env.COCALC_RUNTIME_HOME = "home/user";

    await expect(get_homeDirectory()).rejects.toThrow(
      "COCALC_RUNTIME_HOME must be an absolute path",
    );
  });
});
