/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { ClusterLink } from "./cluster";
import type { Client } from "./client";

function createLink(): ClusterLink {
  return new ClusterLink({} as Client, "remote", "test", "http://remote");
}

describe("ClusterLink.waitForInterest", () => {
  it("resolves when interest appears", async () => {
    const link = createLink();
    const waiting = link.waitForInterest("terminal.project.test", 1_000);

    link.interest.set("terminal.project.test", {
      "": new Set(["room"]),
    });

    await expect(waiting).resolves.toBe(true);
  });

  it("honors its timeout when no interest changes", async () => {
    const link = createLink();

    await expect(
      link.waitForInterest("terminal.project.missing", 25),
    ).rejects.toThrow("timeout");
  });

  it("observes abort while no interest changes", async () => {
    const link = createLink();
    const controller = new AbortController();
    const waiting = link.waitForInterest(
      "terminal.project.missing",
      1_000,
      controller.signal,
    );

    controller.abort();

    await expect(waiting).resolves.toBe(false);
  });
});
