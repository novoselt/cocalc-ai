/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import type { ChatSnapshot } from "./types";
import {
  RemoteHeadlessChatClient,
  essentialChatSubject,
  type EssentialChatStreamEvent,
} from "./remote-client";

const ACCOUNT_ID = "22222222-2222-4222-8222-222222222222";
const PROJECT_ID = "11111111-1111-4111-8111-111111111111";
const PATH = "/home/user/test.chat";
const THREAD_ID = "thread-1";

function snapshot(revision: number, content: string): ChatSnapshot {
  return {
    revision,
    connection: "connected",
    ready: true,
    project_id: PROJECT_ID,
    path: PATH,
    selected_thread_id: THREAD_ID,
    threads: [{ thread_id: THREAD_ID, state: "idle" }],
    messages: [
      {
        message_id: "message-1",
        thread_id: THREAD_ID,
        sender_id: "codex",
        role: "agent",
        content,
        date: "2026-08-15T00:00:00.000Z",
        generating: false,
      },
    ],
  };
}

function createClient(projectHostClient: any) {
  return new RemoteHeadlessChatClient({
    account_id: ACCOUNT_ID,
    project_id: PROJECT_ID,
    path: PATH,
    projectHostClient,
    selected_thread_id: THREAD_ID,
  });
}

test("builds a project- and account-scoped service subject", () => {
  expect(
    essentialChatSubject({ account_id: ACCOUNT_ID, project_id: PROJECT_ID }),
  ).toBe(`services.account-${ACCOUNT_ID}._.${PROJECT_ID}._.essential-chat`);
  expect(() =>
    essentialChatSubject({ account_id: "invalid", project_id: PROJECT_ID }),
  ).toThrow("valid account and project ids");
});

test("cleans up a server session when the update stream cannot open", async () => {
  const request = jest.fn(async (_subject, [name]) => {
    if (name === "open") {
      return {
        data: {
          session_id: `session-${request.mock.calls.length}`,
          stream_name: "broken-stream",
          snapshot: snapshot(1, "initial"),
        },
      };
    }
    return { data: null };
  });
  const client = createClient({
    request,
    sync: {
      dstream: jest.fn(async () => Promise.reject(new Error("offline"))),
    },
  });

  await expect(client.open()).rejects.toThrow("offline");
  await expect(client.open()).rejects.toThrow("offline");

  expect(
    request.mock.calls.filter(([, [name]]) => name === "open"),
  ).toHaveLength(2);
  expect(
    request.mock.calls.filter(([, [name]]) => name === "close"),
  ).toHaveLength(2);
});

test("ignores stream updates older than the current server snapshot", () => {
  const client = createClient({});
  const internal = client as any;
  internal.applySnapshot(snapshot(2, "current"), true);
  internal.handleEvent({
    kind: "update",
    revision: 1,
    connection: "connected",
    ready: true,
    messages: [{ ...snapshot(1, "stale").messages[0], content: "stale" }],
  } satisfies EssentialChatStreamEvent);

  expect(client.getSnapshot().messages[0].content).toBe("current");
});
