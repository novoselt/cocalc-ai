/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import type { ChatSnapshot, ProjectedChatMessage } from "@cocalc/chat-client";
import {
  boundedEssentialChatSnapshot,
  essentialChatUpdate,
  normalizeEssentialChatPath,
  normalizeEssentialChatLimit,
} from "./essential-chat-service";

function message(
  index: number,
  content = `message ${index}`,
): ProjectedChatMessage {
  return {
    message_id: `message-${index}`,
    thread_id: "thread-1",
    sender_id: "account-1",
    role: index % 2 ? "agent" : "human",
    content,
    date: new Date(index * 1000).toISOString(),
    generating: false,
    acp_events: [{ large: "internal detail" }],
    activity: {
      state: "ready",
      events: [{ type: "text", text: "internal detail" }] as any[],
      markdown: `activity ${index}`,
    },
  };
}

function snapshot(messages: ProjectedChatMessage[]): ChatSnapshot {
  return {
    revision: 1,
    connection: "connected",
    ready: true,
    project_id: "11111111-1111-4111-8111-111111111111",
    path: "/home/user/test.chat",
    selected_thread_id: "thread-1",
    threads: [{ thread_id: "thread-1", state: "idle" }],
    messages,
  };
}

describe("essential chat projection", () => {
  it("loads a bounded recent tail without ACP event payloads", () => {
    const projected = boundedEssentialChatSnapshot(
      snapshot(Array.from({ length: 50 }, (_, index) => message(index))),
      10,
    );
    expect(projected.messages.map(({ message_id }) => message_id)).toEqual(
      Array.from({ length: 10 }, (_, index) => `message-${index + 40}`),
    );
    expect(projected.message_window).toEqual({
      limit: 10,
      loaded: 10,
      has_older: true,
      omitted: 40,
    });
    expect(projected.messages[0].acp_events).toBeUndefined();
    expect(projected.messages[0].activity?.events).toEqual([]);
  });

  it("caps invalid and excessive limits", () => {
    expect(normalizeEssentialChatLimit(Number.NaN)).toBe(30);
    expect(normalizeEssentialChatLimit(-1)).toBe(30);
    expect(normalizeEssentialChatLimit(20_000)).toBe(500);
  });

  it("confines chat paths to the project home directory", () => {
    expect(normalizeEssentialChatPath("/home/user/work/../test.chat")).toBe(
      "/home/user/test.chat",
    );
    expect(() =>
      normalizeEssentialChatPath("/home/user/../etc/private.chat"),
    ).toThrow("under /home/user");
    expect(() => normalizeEssentialChatPath("/tmp/test.sage-chat")).toThrow(
      "under /home/user",
    );
  });

  it("truncates oversized individual message content", () => {
    const projected = boundedEssentialChatSnapshot(
      snapshot([message(1, "x".repeat(300_000))]),
      30,
    );
    expect(Buffer.byteLength(projected.messages[0].content)).toBeLessThan(
      140 * 1024,
    );
    expect(projected.messages[0].content).toContain("content omitted");
  });

  it("emits only changed and removed messages", () => {
    const before = boundedEssentialChatSnapshot(
      snapshot([message(1), message(2)]),
      30,
    );
    const after = boundedEssentialChatSnapshot(
      { ...snapshot([message(2, "changed"), message(3)]), revision: 2 },
      30,
    );
    expect(essentialChatUpdate(before, after)).toMatchObject({
      kind: "update",
      revision: 2,
      messages: [
        expect.objectContaining({
          message_id: "message-2",
          content: "changed",
        }),
        expect.objectContaining({ message_id: "message-3" }),
      ],
      removed_message_ids: ["message-1"],
    });
  });
});
