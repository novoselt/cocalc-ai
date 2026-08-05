/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { EventEmitter } from "events";

describe("ConatClient startup", () => {
  it("replays identity received while control-plane bootstrap is pending", async () => {
    jest.resetModules();

    class MockCoreClient extends EventEmitter {
      inboxPrefixHook: any;
      info: any;
      stats = {};
      conn: EventEmitter & {
        connected: boolean;
        io: { on: jest.Mock; engine: { close: jest.Mock } };
      };
      connect = jest.fn();
      close = jest.fn();
      disconnect = jest.fn();
      request = jest.fn();

      constructor() {
        super();
        this.conn = Object.assign(new EventEmitter(), {
          connected: true,
          io: { on: jest.fn(), engine: { close: jest.fn() } },
        });
      }
    }

    const hubClient = new MockCoreClient();
    let resolveBootstrap: (value: any) => void = () => undefined;
    const getAuthBootstrap = jest.fn(
      async () =>
        await new Promise((resolve) => {
          resolveBootstrap = resolve;
        }),
    );
    const clientEmit = jest.fn();

    jest.doMock("@cocalc/frontend/app-framework", () => ({
      redux: { getStore: jest.fn(), getActions: jest.fn() },
    }));
    jest.doMock("@cocalc/util/reuse-in-flight", () => ({
      reuseInFlight: (fn: any) => fn,
    }));
    jest.doMock("@cocalc/conat/core/client", () => ({
      connect: jest.fn(() => hubClient),
    }));
    jest.doMock("@cocalc/conat/client", () => ({
      getClient: () => ({ on: jest.fn() }),
      setConatClient: jest.fn(),
    }));
    jest.doMock("@cocalc/conat/time", () => ({
      __esModule: true,
      default: jest.fn(() => Date.now()),
      getSkew: jest.fn(async () => 0),
      init: jest.fn(),
    }));
    jest.doMock("@cocalc/conat/hub/api", () => ({
      initHubApi: () => ({}),
    }));
    jest.doMock("./browser-session", () => ({
      createBrowserSessionAutomation: () => ({
        start: jest.fn(async () => undefined),
        stop: jest.fn(async () => undefined),
      }),
    }));
    jest.doMock("@cocalc/frontend/customize/exam-mode", () => ({
      isExamMode: () => false,
      waitForExamModeConfiguration: async () => false,
    }));
    jest.doMock("@cocalc/frontend/customize/app-base-path", () => ({
      appBasePath: "",
    }));
    jest.doMock("@cocalc/frontend/client/handle-target", () => ({
      __esModule: true,
      default: "",
    }));
    jest.doMock("@cocalc/frontend/client/client", () => ({
      ACCOUNT_ID_COOKIE: "account_id",
    }));
    jest.doMock("@cocalc/frontend/lite", () => ({ lite: false }));
    jest.doMock("@cocalc/frontend/misc/remember-me", () => ({
      deleteRememberMe: jest.fn(),
      hasRememberMe: jest.fn(() => false),
      setRememberMe: jest.fn(),
    }));
    jest.doMock("js-cookie", () => ({
      __esModule: true,
      default: { get: jest.fn(() => "account-1"), set: jest.fn() },
    }));
    jest.doMock("@cocalc/frontend/control-plane-origin", () => ({
      clearStoredControlPlaneOrigin: jest.fn(),
      getControlPlaneAppUrl: jest.fn(() => "http://hub"),
      getStoredControlPlaneOrigin: jest.fn(() => "http://hub"),
      normalizeControlPlaneOrigin: jest.fn((value: string) => value),
      setStoredControlPlaneOrigin: jest.fn(),
    }));
    jest.doMock("@cocalc/frontend/auth/api", () => ({ getAuthBootstrap }));

    const { ConatClient } = require("./client");
    const client = new ConatClient(
      {
        account_id: "account-1",
        browser_id: "browser-1",
        emit: clientEmit,
      },
      { address: "http://hub" },
    );

    await Promise.resolve();
    expect(getAuthBootstrap).toHaveBeenCalledTimes(1);
    client.conat();
    hubClient.info = {
      id: "hub-1",
      user: { account_id: "account-1" },
    };
    hubClient.emit("info", hubClient.info);
    expect(clientEmit).not.toHaveBeenCalledWith("signed_in", expect.anything());

    resolveBootstrap({
      signed_in: true,
      home_bay_id: "bay-1",
      home_bay_url: "http://hub",
    });
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();

    expect(clientEmit).toHaveBeenCalledWith("signed_in", {
      account_id: "account-1",
      hub: "hub-1",
    });
  });
});
