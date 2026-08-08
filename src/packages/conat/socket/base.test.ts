import { EventEmitter } from "events";
import { ConatSocketBase } from "./base";

class TestSocket extends ConatSocketBase {
  channel(channel: string) {
    return channel;
  }

  protected async run(): Promise<void> {}

  end(): void {}

  protected initTCP(): void {}
}

describe("ConatSocketBase.waitUntilReady", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("classifies readiness expiration as a request timeout", async () => {
    const client = new EventEmitter() as any;
    client.waitUntilConnected = jest.fn(
      () => new Promise<void>(() => undefined),
    );

    const socket = new TestSocket({
      subject: "test.socket",
      client,
      role: "client",
      id: "socket-1",
      reconnection: false,
    });
    const ready = socket.waitUntilReady(1_000);

    jest.advanceTimersByTime(1_000);

    await expect(ready).rejects.toMatchObject({
      message: "timeout",
      code: 408,
    });
    socket.close();
  });

  it("reports time spent waiting for the underlying transport", async () => {
    const lifecycleReporter = jest.fn();
    const client = new EventEmitter() as any;
    client.conn = { connected: false };
    client.waitUntilConnected = jest.fn(async () => {
      client.conn.connected = true;
    });

    const socket = new TestSocket({
      subject: "test.socket",
      client,
      role: "client",
      id: "socket-1",
      reconnection: false,
      lifecycleReporter,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(lifecycleReporter.mock.calls).toEqual([
      ["transport_wait_start", { transport_connected: false }],
      ["transport_wait_done", { transport_connected: true }],
    ]);
    socket.close();
  });
});
