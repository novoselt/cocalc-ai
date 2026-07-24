/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Host } from "@cocalc/conat/hub/api/hosts";
import type { SetStateAction } from "react";
import { useHostActions } from "./use-host-actions";

describe("useHostActions deletion protection", () => {
  it("uses the authoritative RPC result before refreshing the host list", async () => {
    const initial = {
      id: "host-1",
      deletion_protection: false,
    } as Host;
    const updated = {
      ...initial,
      deletion_protection: true,
    } as Host;
    let hosts = [initial];
    const setHosts = jest.fn((update: SetStateAction<Host[]>) => {
      hosts = typeof update === "function" ? update(hosts) : update;
    });
    const refresh = jest.fn().mockResolvedValue([updated]);
    const setHostDeletionProtection = jest.fn().mockResolvedValue(updated);

    const actions = useHostActions({
      hub: {
        hosts: {
          startHost: jest.fn(),
          stopHost: jest.fn(),
          deleteHost: jest.fn(),
          setHostDeletionProtection,
        },
      },
      setHosts,
      refresh,
      browser_id: "browser-1",
    });

    await actions.setHostDeletionProtection("host-1", true);

    expect(setHostDeletionProtection).toHaveBeenCalledWith({
      id: "host-1",
      browser_id: "browser-1",
      enabled: true,
    });
    expect(hosts[0].deletion_protection).toBe(true);
    expect(refresh).toHaveBeenCalledTimes(1);
  });
});
