import { EventEmitter } from "events";

const dstreamMock = jest.fn();
const subscribeMock = jest.fn();
const webappClient = Object.assign(new EventEmitter(), {
  conat_client: {
    dstream: dstreamMock,
    conat: jest.fn(() => ({ subscribe: subscribeMock })),
  },
  removeListener: EventEmitter.prototype.removeListener,
});

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: webappClient,
}));

jest.mock("@cocalc/conat/hub/api/account-feed", () => ({
  accountFeedLiveSubject: (account_id: string) =>
    `account.${account_id}.account-feed-live`,
  accountFeedStreamName: () => "account-feed",
}));

class FakeDStream extends EventEmitter {
  close = jest.fn(() => {
    this.emit("closed");
  });
}

class FakeSubscription {
  close = jest.fn();
  private messages: any[] = [];
  private waiting?: (value: IteratorResult<any>) => void;

  push(data: any) {
    if (this.waiting != null) {
      const resolve = this.waiting;
      this.waiting = undefined;
      resolve({ done: false, value: { data } });
      return;
    }
    this.messages.push({ data });
  }

  [Symbol.asyncIterator]() {
    return {
      next: async (): Promise<IteratorResult<any>> => {
        const value = this.messages.shift();
        if (value != null) {
          return { done: false, value };
        }
        return await new Promise((resolve) => {
          this.waiting = resolve;
        });
      },
    };
  }
}

describe("shared account dstream cache", () => {
  beforeEach(() => {
    jest.resetModules();
    dstreamMock.mockReset();
    subscribeMock.mockReset();
    subscribeMock.mockResolvedValue(new FakeSubscription());
    webappClient.removeAllListeners();
  });

  it("reuses the same account/name stream instance", async () => {
    const stream = new FakeDStream();
    dstreamMock.mockResolvedValue(stream);

    const { getSharedAccountDStream, resetSharedAccountDStreamCacheForTests } =
      await import("./account-dstream");
    try {
      const first = await getSharedAccountDStream({
        account_id: "account-1",
        name: "feed",
        ephemeral: true,
      });
      const second = await getSharedAccountDStream({
        account_id: "account-1",
        name: "feed",
        ephemeral: true,
      });

      expect(first).toBe(second);
      expect(dstreamMock).toHaveBeenCalledTimes(1);
    } finally {
      resetSharedAccountDStreamCacheForTests();
    }
  });

  it("drops stale account streams after sign-out", async () => {
    const first = new FakeDStream();
    const second = new FakeDStream();
    dstreamMock.mockResolvedValueOnce(first).mockResolvedValueOnce(second);

    const { getSharedAccountDStream, resetSharedAccountDStreamCacheForTests } =
      await import("./account-dstream");
    try {
      await getSharedAccountDStream({
        account_id: "account-1",
        name: "feed",
        ephemeral: true,
      });
      webappClient.emit("signed_out");
      await getSharedAccountDStream({
        account_id: "account-1",
        name: "feed",
        ephemeral: true,
      });

      expect(first.close).toHaveBeenCalled();
      expect(dstreamMock).toHaveBeenCalledTimes(2);
    } finally {
      resetSharedAccountDStreamCacheForTests();
    }
  });

  it("relays account-feed broadcasts through the shared stream", async () => {
    const stream = new FakeDStream();
    const subscription = new FakeSubscription();
    dstreamMock.mockResolvedValue(stream);
    subscribeMock.mockResolvedValue(subscription);

    const { getSharedAccountDStream, resetSharedAccountDStreamCacheForTests } =
      await import("./account-dstream");
    try {
      const shared = await getSharedAccountDStream({
        account_id: "account-1",
        name: "account-feed",
        ephemeral: true,
      });
      const change = jest.fn();
      shared.on("change", change);
      const event = {
        type: "news.refresh",
        ts: Date.now(),
        account_id: "account-1",
      };
      subscription.push(event);
      await new Promise((resolve) => setTimeout(resolve, 0));

      expect(subscribeMock).toHaveBeenCalledWith(
        "account.account-1.account-feed-live",
      );
      expect(change).toHaveBeenCalledWith(event);
    } finally {
      resetSharedAccountDStreamCacheForTests();
    }
  });
});
