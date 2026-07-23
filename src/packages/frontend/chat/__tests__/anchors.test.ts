/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  computeAnchoredThreads,
  parseThreadAnchor,
  parseThreadResolved,
} from "../anchors";

describe("parseThreadAnchor", () => {
  it("parses a plain anchor object", () => {
    expect(parseThreadAnchor({ id: "abc123", path: "sub.tex" })).toEqual({
      id: "abc123",
      path: "sub.tex",
    });
  });

  it("drops empty/blank ids", () => {
    expect(parseThreadAnchor({ id: "" })).toBeUndefined();
    expect(parseThreadAnchor({ id: "   " })).toBeUndefined();
    expect(parseThreadAnchor(null)).toBeUndefined();
    expect(parseThreadAnchor("abc")).toBeUndefined();
  });

  it("omits blank paths", () => {
    expect(parseThreadAnchor({ id: "x", path: "  " })).toEqual({ id: "x" });
  });

  it("unwraps immutable-style records", () => {
    const fake = { toJS: () => ({ id: "cell-1" }) };
    expect(parseThreadAnchor(fake)).toEqual({ id: "cell-1" });
  });
});

describe("parseThreadResolved", () => {
  it("parses resolved metadata", () => {
    expect(
      parseThreadResolved({
        account_id: "a",
        at: "2026-04-27T00:00:00.000Z",
        anchorId: "hash1234",
        label: "section 2",
      }),
    ).toEqual({
      account_id: "a",
      at: "2026-04-27T00:00:00.000Z",
      anchorId: "hash1234",
      label: "section 2",
    });
  });

  it("requires an anchorId", () => {
    expect(parseThreadResolved({ account_id: "a", at: "t" })).toBeUndefined();
  });
});

function fakeActions({
  rows,
  index,
  readCounts = {},
  readStateReady = true,
}: {
  rows: any[];
  index: Map<string, { messageCount: number; newestTime: number }>;
  readCounts?: Record<string, number>;
  readStateReady?: boolean;
}): any {
  return {
    listThreadConfigRows: () => rows,
    getThreadIndex: () => index,
    getThreadReadCount: (key: string) => readCounts[key] ?? 0,
    isProjectReadStateReady: () => readStateReady,
  };
}

describe("computeAnchoredThreads", () => {
  const rows = [
    { thread_id: "t1", anchor: { id: "cell-a" }, name: "First" },
    { thread_id: "t2", anchor: { id: "cell-a" } },
    { thread_id: "t3", anchor: { id: "cell-b" }, name: "Other cell" },
    {
      thread_id: "t4",
      resolved: { account_id: "u", at: "now", anchorId: "cell-a" },
    },
    { thread_id: "t5", name: "Unanchored" },
  ];
  const index = new Map([
    ["t1", { messageCount: 3, newestTime: 100 }],
    ["t2", { messageCount: 2, newestTime: 200 }],
    ["t3", { messageCount: 1, newestTime: 50 }],
    ["t4", { messageCount: 5, newestTime: 300 }],
  ]);

  it("collects live threads for an anchor, newest first", () => {
    const info = computeAnchoredThreads({
      actions: fakeActions({ rows, index, readCounts: { t1: 1, t2: 2 } }),
      anchorId: "cell-a",
      accountId: "acct",
      resolved: false,
    });
    expect(info.threads.map((t) => t.key)).toEqual(["t2", "t1"]);
    expect(info.totalMessages).toBe(5);
    // t1 has 3 messages, 1 read => 2 unread; t2 fully read.
    expect(info.totalUnread).toBe(2);
    expect(info.threads[0].label).toBe("Discussion");
    expect(info.threads[1].label).toBe("First");
  });

  it("never counts unread before read state is ready", () => {
    const info = computeAnchoredThreads({
      actions: fakeActions({ rows, index, readStateReady: false }),
      anchorId: "cell-a",
      accountId: "acct",
      resolved: false,
    });
    expect(info.totalUnread).toBe(0);
  });

  it("excludes resolved threads from live matches", () => {
    const info = computeAnchoredThreads({
      actions: fakeActions({ rows, index }),
      anchorId: "cell-a",
      accountId: "acct",
      resolved: false,
    });
    expect(info.threads.map((t) => t.key)).not.toContain("t4");
  });

  it("finds resolved threads by former anchor id", () => {
    const info = computeAnchoredThreads({
      actions: fakeActions({ rows, index }),
      anchorId: "cell-a",
      accountId: "acct",
      resolved: true,
    });
    expect(info.threads.map((t) => t.key)).toEqual(["t4"]);
  });

  it("returns nothing without an anchor id or actions", () => {
    expect(
      computeAnchoredThreads({
        actions: undefined,
        anchorId: "cell-a",
        accountId: "acct",
        resolved: false,
      }).threads,
    ).toEqual([]);
    expect(
      computeAnchoredThreads({
        actions: fakeActions({ rows, index }),
        anchorId: "",
        accountId: "acct",
        resolved: false,
      }).threads,
    ).toEqual([]);
  });

  it("includes config-only threads with zero messages", () => {
    const info = computeAnchoredThreads({
      actions: fakeActions({
        rows: [{ thread_id: "t9", anchor: { id: "cell-z" }, name: "Empty" }],
        index: new Map(),
      }),
      anchorId: "cell-z",
      accountId: "acct",
      resolved: false,
    });
    expect(info.threads).toHaveLength(1);
    expect(info.threads[0].messageCount).toBe(0);
    expect(info.totalUnread).toBe(0);
  });
});
