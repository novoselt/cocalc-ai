import { EventEmitter } from "node:events";

const mockImmerdb = jest.fn();

jest.mock("@cocalc/conat/sync-doc/immer-db", () => ({
  immerdb: (...args: any[]) => mockImmerdb(...args),
}));

jest.mock("@cocalc/conat/logger", () => ({
  getLogger: () => ({
    debug: jest.fn(),
  }),
}));

import { acquireChatSyncDB, releaseChatSyncDB } from "../server";

class MockSyncDB extends EventEmitter {
  close = jest.fn(async () => {});

  constructor(private readonly ready: boolean) {
    super();
  }

  isReady(): boolean {
    return this.ready;
  }
}

describe("chat SyncDB pool", () => {
  it("times out a stalled open and releases its lease", async () => {
    const stalled = new MockSyncDB(false);
    const ready = new MockSyncDB(true);
    mockImmerdb.mockReturnValueOnce(stalled).mockReturnValueOnce(ready);
    const opts = {
      client: {} as any,
      project_id: "project-1",
      path: "/root/test.chat",
      readyTimeoutMs: 5,
    };

    await expect(acquireChatSyncDB(opts)).rejects.toThrow(
      "timed out waiting for chat SyncDB",
    );
    expect(stalled.close).toHaveBeenCalledTimes(1);

    await expect(acquireChatSyncDB(opts)).resolves.toBe(ready);
    await releaseChatSyncDB(opts.project_id, opts.path);
  });
});
