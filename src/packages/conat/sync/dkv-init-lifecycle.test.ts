/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { RecoveryState } from "./core-stream";

const mockCoreStreams: MockCoreStream[] = [];

class MockCoreStream extends (require("events")
  .EventEmitter as typeof import("events").EventEmitter) {
  recoveryState: RecoveryState = "ready";
  init = jest.fn(async () => {});
  config = jest.fn(async (config) => config);
  close = jest.fn(() => {
    this.recoveryState = "closed";
  });
  getRecoveryState = jest.fn(() => this.recoveryState);
}

jest.mock("./core-stream", () => ({
  CoreStream: class extends MockCoreStream {
    constructor() {
      super();
      mockCoreStreams.push(this);
    }
  },
}));

import { DKV } from "./dkv";

function deferred<T = void>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createDkv() {
  return new DKV({
    name: "init-lifecycle",
    client: {} as any,
    noInventory: true,
  });
}

describe("DKV initialization lifecycle", () => {
  beforeEach(() => {
    mockCoreStreams.length = 0;
  });

  it("stops initialization when the core stream closes during bootstrap", async () => {
    const dkv = createDkv();
    const stream = mockCoreStreams[0];
    stream.init.mockImplementation(async () => {
      stream.recoveryState = "closed";
    });
    const connected = jest.fn();
    dkv.on("connected", connected);

    await expect(dkv.init()).resolves.toBeUndefined();

    expect(stream.config).not.toHaveBeenCalled();
    expect(connected).not.toHaveBeenCalled();
  });

  it("stops initialization when DKV closes during core stream bootstrap", async () => {
    const init = deferred();
    const dkv = createDkv();
    const stream = mockCoreStreams[0];
    stream.init.mockImplementation(async () => await init.promise);
    const connected = jest.fn();
    dkv.on("connected", connected);

    const initializing = dkv.init();
    dkv.close();
    init.resolve();

    await expect(initializing).resolves.toBeUndefined();
    expect(stream.config).not.toHaveBeenCalled();
    expect(connected).not.toHaveBeenCalled();
  });

  it("does not finish initialization when DKV closes during config", async () => {
    const configStarted = deferred();
    const configFinished = deferred();
    const dkv = createDkv();
    const stream = mockCoreStreams[0];
    stream.config.mockImplementation(async () => {
      configStarted.resolve();
      await configFinished.promise;
      return {};
    });
    const connected = jest.fn();
    dkv.on("connected", connected);

    const initializing = dkv.init();
    await configStarted.promise;
    dkv.close();
    configFinished.resolve();

    await expect(initializing).resolves.toBeUndefined();
    expect(stream.config).toHaveBeenCalledWith({ allow_msg_ttl: true });
    expect(connected).not.toHaveBeenCalled();
  });

  it("configures message TTL and connects while the stream remains active", async () => {
    const dkv = createDkv();
    const stream = mockCoreStreams[0];
    const connected = jest.fn();
    dkv.on("connected", connected);

    await dkv.init();

    expect(stream.config).toHaveBeenCalledWith({ allow_msg_ttl: true });
    expect(connected).toHaveBeenCalledTimes(1);
  });
});
