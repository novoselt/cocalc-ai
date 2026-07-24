/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { system } from "./system";

describe("system API authentication", () => {
  const authenticate = system.resolveManagedProjectSshKeyAccount;

  it("requires a host identity to resolve managed project SSH keys", async () => {
    await expect(
      authenticate({
        args: [{ project_id: "project-1", fingerprint: "aa:bb:cc" }],
        account_id: "account-1",
      } as any),
    ).rejects.toThrow("must be a host");
  });

  it("injects the authenticated host identity", async () => {
    const args = [
      {
        host_id: "untrusted-host",
        project_id: "project-1",
        fingerprint: "aa:bb:cc",
      },
    ];

    await expect(
      authenticate({ args, host_id: "authenticated-host" } as any),
    ).resolves.toEqual([
      {
        host_id: "authenticated-host",
        project_id: "project-1",
        fingerprint: "aa:bb:cc",
      },
    ]);
  });
});
