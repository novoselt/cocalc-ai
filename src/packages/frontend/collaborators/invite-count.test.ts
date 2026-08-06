import {
  beginUnreadIncomingInviteCountRefresh,
  getUnreadIncomingInviteCount,
  setUnreadIncomingInviteCount,
  subscribeUnreadIncomingInviteCount,
} from "./invite-count";

describe("invite unread count", () => {
  afterEach(() => {
    setUnreadIncomingInviteCount(undefined, 0);
  });

  it("normalizes and publishes unread invite counts", () => {
    const seen: number[] = [];
    const unsubscribe = subscribeUnreadIncomingInviteCount((count) => {
      seen.push(count);
    });
    try {
      setUnreadIncomingInviteCount("account-1", 3.9);
      expect(getUnreadIncomingInviteCount("account-1")).toBe(3);
      setUnreadIncomingInviteCount("account-1", -10);
      expect(getUnreadIncomingInviteCount("account-1")).toBe(0);
    } finally {
      unsubscribe();
    }
    expect(seen).toEqual([3, 0]);
  });

  it("does not expose one account's invite count to another account", () => {
    setUnreadIncomingInviteCount("account-1", 2);

    expect(getUnreadIncomingInviteCount("account-1")).toBe(2);
    expect(getUnreadIncomingInviteCount("account-2")).toBe(0);
    expect(getUnreadIncomingInviteCount()).toBe(0);
  });

  it("ignores a stale refresh result", () => {
    const first = beginUnreadIncomingInviteCountRefresh("account-1");
    const second = beginUnreadIncomingInviteCountRefresh("account-1");

    setUnreadIncomingInviteCount("account-1", 2, second);
    setUnreadIncomingInviteCount("account-1", 5, first);

    expect(getUnreadIncomingInviteCount("account-1")).toBe(2);
  });
});
