/*
 * This file is part of CoCalc: Copyright © 2026 SageMath, Inc.
 * License: MS-RSL – see LICENSE.md for details
 */

import { EventEmitter } from "node:events";

import type { AcpStreamMessage } from "@cocalc/conat/ai/acp/types";

let dbMock: EventEmitter & {
  isReady: () => boolean;
  get: () => Record<string, any>[];
  close: jest.Mock;
};

jest.mock("@cocalc/conat/sync-doc/immer-db", () => ({
  immerdb: () => dbMock,
}));

import { createHeadlessChatClient } from "./client";

async function until(predicate: () => boolean, timeoutMs = 1_500) {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error("timed out");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe("headless chat activity recovery", () => {
  it("loads the durable project-host activity log for a completed row", async () => {
    const events: AcpStreamMessage[] = [
      {
        type: "event",
        seq: 1,
        event: {
          type: "terminal",
          terminalId: "terminal-1",
          phase: "exit",
          command: "expr",
          args: ["17", "+", "45"],
          output: "62\n",
          exitStatus: { exitCode: 0 },
        },
      },
      { type: "summary", seq: 2, finalResponse: "Done." },
    ];
    dbMock = Object.assign(new EventEmitter(), {
      isReady: () => true,
      get: () => [
        {
          event: "chat",
          sender_id: "agent-account",
          date: "2026-08-14T00:00:00.000Z",
          message_id: "message-1",
          thread_id: "thread-1",
          acp_account_id: "agent-account",
          acp_log_store: "acp-log/chat.chat",
          acp_log_key: "thread-1:message-1",
          generating: false,
          history: [
            {
              author_id: "agent-account",
              content: "Done.",
              date: "2026-08-14T00:00:01.000Z",
            },
          ],
        },
      ],
      close: jest.fn(async () => undefined),
    });
    const projectHostClient = Object.assign(new EventEmitter(), {
      sync: {
        akv: jest.fn(() => ({
          get: jest.fn(async () => events),
          close: jest.fn(),
        })),
      },
    });
    const client = createHeadlessChatClient({
      account_id: "account-1",
      project_id: "project-1",
      path: "chat.chat",
      projectHostClient: projectHostClient as any,
      selected_thread_id: "thread-1",
    });

    await client.open();
    await until(
      () => client.getSnapshot().messages[0]?.activity?.state === "ready",
    );

    expect(client.getSnapshot().messages[0]).toEqual(
      expect.objectContaining({
        content: "Done.",
        activity: expect.objectContaining({
          state: "ready",
          markdown: expect.stringContaining("62"),
        }),
      }),
    );
    await client.close();
  });
});
