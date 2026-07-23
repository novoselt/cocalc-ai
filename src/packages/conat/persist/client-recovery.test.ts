/*
 *  This file is part of CoCalc: Copyright © 2026 SageMath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { EventEmitter } from "events";
import { disablePermissionCheck, stream } from "@cocalc/conat/persist/client";

class FakeSocket extends EventEmitter {
  state = "ready";
  close = jest.fn();
  write = jest.fn();
}

function createClient({ registerRecoveryWithScheduler = true } = {}) {
  const socket = new FakeSocket();
  const requestRecovery = jest.fn();
  const registration = {
    requestRecovery,
    close: jest.fn(),
  };
  const registerResource = jest.fn(() => registration);
  const client: any = {
    id: `client-${Math.random()}`,
    state: "connected",
    socket: {
      connect: jest.fn(() => socket),
    },
    recoveryScheduler: {
      registerResource,
    },
  };
  const persist: any = stream({
    client,
    user: { hub_id: "test" },
    storage: { path: `test/${Math.random()}` },
    noCache: true,
    registerRecoveryWithScheduler,
  });
  persist.changefeeds.push({ close: jest.fn() });
  persist.reconnecting = true;
  return {
    persist,
    registration,
    registerResource,
    requestRecovery,
    socket,
  };
}

describe("persist socket-ready recovery", () => {
  beforeAll(() => {
    process.env.COCALC_TEST_MODE = "true";
    disablePermissionCheck();
  });

  it("routes catch-up through the recovery scheduler", () => {
    const { persist, requestRecovery, socket } = createClient();
    const getMissed = jest.fn();
    persist.getMissed = getMissed;

    socket.emit("ready");

    expect(getMissed).not.toHaveBeenCalled();
    expect(requestRecovery).toHaveBeenCalledWith({
      reason: "persist_socket_ready",
      resetBackoff: true,
    });
    expect(persist.getRecoveryState()).toBe("recovering");
    persist.close();
  });

  it("contains catch-up failures when recovery scheduling is disabled", async () => {
    const { persist, registerResource, socket } = createClient({
      registerRecoveryWithScheduler: false,
    });
    persist.getMissed = jest.fn(async () => {
      throw new Error("catch-up failed");
    });

    socket.emit("ready");
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(registerResource).not.toHaveBeenCalled();
    expect(persist.getRecoveryState()).toBe("disconnected");
    persist.close();
  });
});
