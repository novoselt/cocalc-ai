/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

jest.mock("@cocalc/frontend/app-framework", () => ({
  redux: {
    getStore: () => ({ get: () => new Map() }),
  },
}));

jest.mock("../user-name", () => ({
  getUserName: () => "Ada Lovelace",
}));

import { messageToMarkdown } from "../message-to-markdown";

const message = {
  date: new Date("2026-08-11T12:00:00.000Z"),
  event: "chat",
  sender_id: "account-1",
  history: [
    {
      author_id: "account-1",
      content: "Hello from CoCalc",
      date: "2026-08-11T12:00:00.000Z",
    },
  ],
};

test("exports the message body without loading UI-only chat modules", () => {
  expect(messageToMarkdown(message, { includeHeader: false })).toBe(
    "Hello from CoCalc",
  );
});

test("adds the sender, date, and an optional pre-rendered log", () => {
  const markdown = messageToMarkdown(message, {
    logMarkdown: "- Agent: finished",
  });
  expect(markdown).toContain("*From:* Ada Lovelace");
  expect(markdown).toContain("*Date:* Tue Aug 11 2026");
  expect(markdown).toContain(
    "Hello from CoCalc\n\n**Log**\n\n- Agent: finished",
  );
});
