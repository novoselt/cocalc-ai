/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { RecoveryState } from "./core-stream";

const mockCoreStreams: MockCoreStream[] = [];
const mockCoreStreamOptions: any[] = [];

class MockCoreStream extends (require("events")
  .EventEmitter as typeof import("events").EventEmitter) {
  recoveryState: RecoveryState = "ready";
  init = jest.fn(async () => {});
  config = jest.fn(async (config) => config);
  close = jest.fn(() => {
    this.recoveryState = "closed";
  });
  getKv = jest.fn(() => {
    throw Error("closed stream");
  });
  getRecoveryState = jest.fn(() => this.recoveryState);
}

jest.mock("./core-stream", () => ({
  CoreStream: class extends MockCoreStream {
    constructor(options) {
      super();
      mockCoreStreams.push(this);
      mockCoreStreamOptions.push(options);
    }
  },
}));

import { DKV, dkv } from "./dkv";

function deferred<T = void>() {
  let resolve: (value: T | PromiseLike<T>) => void = () => {};
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function createDkv(config?) {
  return new DKV({
    name: "init-lifecycle",
    client: {} as any,
    noInventory: true,
    config,
  });
}

describe("DKV initialization lifecycle", () => {
  beforeEach(() => {
    mockCoreStreams.length = 0;
    mockCoreStreamOptions.length = 0;
  });

  it("enables message TTL in the retrying CoreStream bootstrap config", () => {
    createDkv({ max_age: 123, allow_msg_ttl: false });

    expect(mockCoreStreamOptions[0].config).toEqual({
      max_age: 123,
      allow_msg_ttl: true,
    });
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

  it("reports closure and still cleans up after the core stream closes itself", () => {
    const dkv = createDkv();
    const stream = mockCoreStreams[0];
    stream.recoveryState = "closed";

    expect(dkv.isClosed()).toBe(true);

    dkv.close();

    expect(stream.close).toHaveBeenCalledTimes(1);
  });

  it("replaces a cached DKV whose core stream closed itself", async () => {
    const client = { id: "closed-core-stream-cache-test" } as any;
    const options = {
      name: "closed-core-stream-cache-test",
      client,
      noInventory: true,
    };
    const first = await dkv(options);
    const secondReference = await dkv(options);
    expect(secondReference).toBe(first);

    mockCoreStreams[0].recoveryState = "closed";
    const replacement = await dkv(options);

    expect(replacement).not.toBe(first);
    expect(mockCoreStreams).toHaveLength(2);

    first.close();
    secondReference.close();
    expect(replacement.isClosed()).toBe(false);
    replacement.close();
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

  it("connects without a second post-bootstrap config RPC", async () => {
    const dkv = createDkv();
    const stream = mockCoreStreams[0];
    const connected = jest.fn();
    dkv.on("connected", connected);

    await dkv.init();

    expect(stream.config).not.toHaveBeenCalled();
    expect(connected).toHaveBeenCalledTimes(1);
  });

  it("does not turn Promise's then probe into a DKV key lookup", async () => {
    const dkv = createDkv();
    const stream = mockCoreStreams[0];

    await expect(Promise.resolve(dkv)).resolves.toBe(dkv);
    expect(stream.getKv).not.toHaveBeenCalled();
  });
});
