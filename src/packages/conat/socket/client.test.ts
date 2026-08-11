/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { ConatSocketClient } from "./client";
import { serverStatusSubject } from "./util";

describe("ConatSocketClient server discovery", () => {
  it("allows enough time for the first distributed interest round trip", async () => {
    const client = {
      waitForInterest: jest.fn(async () => true),
      request: jest.fn(async () => ({ data: { id: "server-1" } })),
    };
    const socket = Object.assign(Object.create(ConatSocketClient.prototype), {
      client,
      state: "connecting",
      subject: "terminal.project-test.0",
    }) as ConatSocketClient;

    await (
      socket as unknown as { waitForServerId: () => Promise<void> }
    ).waitForServerId();

    expect(client.waitForInterest).toHaveBeenCalledWith(
      serverStatusSubject(socket.subject),
      { timeout: 250 },
    );
    expect(client.request).toHaveBeenCalledWith(
      serverStatusSubject(socket.subject),
      null,
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("retries immediately after a probe used its full timeout", async () => {
    jest.useFakeTimers();
    try {
      const client = {
        waitForInterest: jest
          .fn()
          .mockImplementationOnce(
            async () =>
              await new Promise((_, reject) => {
                setTimeout(() => reject(new Error("timeout")), 250);
              }),
          )
          .mockResolvedValue(true),
        request: jest.fn(async () => ({ data: { id: "server-1" } })),
      };
      const socket = Object.assign(Object.create(ConatSocketClient.prototype), {
        client,
        state: "connecting",
        subject: "terminal.project-test.0",
      }) as ConatSocketClient;

      const waiting = (
        socket as unknown as { waitForServerId: () => Promise<void> }
      ).waitForServerId();
      await jest.advanceTimersByTimeAsync(250);
      await waiting;

      expect(client.waitForInterest).toHaveBeenCalledTimes(2);
      expect(client.waitForInterest.mock.calls[1][1]).toEqual({
        timeout: 375,
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
