import { CoreStream } from "./core-stream";

function createStream() {
  return new CoreStream({
    name: "history-gap-test",
    client: {
      state: "ready",
      recoveryScheduler: {
        registerResource: jest.fn(() => ({
          requestRecovery: jest.fn(),
          close: jest.fn(),
        })),
      },
    } as any,
  });
}

describe("CoreStream history gap propagation", () => {
  it("returns empty KV read views after the stream closes", () => {
    const stream = createStream();
    (stream as any).kv.path = {
      mesg: { value: "before-close" },
      raw: {
        seq: 1,
        timestamp: Date.now(),
        headers: { test: "value" },
      },
    };

    stream.close();

    expect(stream.getKv("path")).toBeUndefined();
    expect(stream.hasKv("path")).toBe(false);
    expect(stream.getAllKv()).toEqual({});
    expect(stream.keysKv()).toEqual([]);
    expect(stream.seqKv("path")).toBeUndefined();
    expect(stream.timeKv("path")).toBeUndefined();
    expect(stream.timeKv()).toEqual({});
    expect(stream.headersKv("path")).toBeUndefined();
    expect(stream.lengthKv).toBe(0);
  });

  it("emits history-gap when replay starts after the requested seq", async () => {
    const stream = createStream();
    const events: any[] = [];
    stream.on("history-gap", (info) => {
      events.push(info);
    });
    const persistClient = {
      changefeed: jest.fn().mockResolvedValue({}),
      getAllWithInfo: jest.fn().mockResolvedValue({
        messages: [],
        effective_start_seq: 14,
        oldest_retained_seq: 14,
        newest_retained_seq: 19,
      }),
    };
    (stream as any).persistClient = persistClient;

    await (stream as any).getAllFromPersist({
      start_seq: 10,
      noEmit: false,
      includeConfig: false,
    });

    expect(events).toEqual([
      {
        requested_start_seq: 10,
        effective_start_seq: 14,
        oldest_retained_seq: 14,
        newest_retained_seq: 19,
      },
    ]);
  });

  it("does not emit history-gap when the requested seq is still retained", async () => {
    const stream = createStream();
    const events: any[] = [];
    stream.on("history-gap", (info) => {
      events.push(info);
    });
    const persistClient = {
      changefeed: jest.fn().mockResolvedValue({}),
      getAllWithInfo: jest.fn().mockResolvedValue({
        messages: [],
        effective_start_seq: 10,
        oldest_retained_seq: 10,
        newest_retained_seq: 19,
      }),
    };
    (stream as any).persistClient = persistClient;

    await (stream as any).getAllFromPersist({
      start_seq: 10,
      noEmit: false,
      includeConfig: false,
    });

    expect(events).toEqual([]);
  });

  it("stops retrying bootstrap when the persist client is closed", async () => {
    const stream = createStream();
    const persistClient = {
      changefeed: jest.fn().mockResolvedValue({}),
      close: jest.fn(),
      getAllWithInfo: jest.fn().mockRejectedValue(new Error("closed")),
    };
    (stream as any).persistClient = persistClient;

    await (stream as any).getAllFromPersist({
      start_seq: 10,
      noEmit: false,
      includeConfig: false,
      retry: true,
    });

    expect(persistClient.getAllWithInfo).toHaveBeenCalledTimes(1);
    expect(persistClient.close).toHaveBeenCalledTimes(1);
    expect((stream as any).client).toBeUndefined();
  });
});
