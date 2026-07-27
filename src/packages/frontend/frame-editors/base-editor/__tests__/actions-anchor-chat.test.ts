/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const mockGetSideChatActions = jest.fn();

jest.mock("@cocalc/frontend/frame-editors/generic/chat", () => ({
  chat: { type: "chat" },
  getSideChatActions: (...args) => mockGetSideChatActions(...args),
}));

import { TextEditorActions } from "../actions-text";

describe("anchored side-chat readiness", () => {
  afterEach(() => {
    jest.useRealTimers();
    mockGetSideChatActions.mockReset();
  });

  it("checks once more after the final retry delay", async () => {
    jest.useFakeTimers();
    const readyActions = {
      syncdb: { get_state: () => "ready" },
      frameTreeActions: {},
    };
    mockGetSideChatActions
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => undefined)
      .mockReturnValue(readyActions);

    const actions: any = Object.create(TextEditorActions.prototype);
    actions.project_id = "project-1";
    actions.path = "notes.tex";
    actions._openAnchorChatGeneration = 1;
    actions.isClosed = jest.fn(() => false);

    const waiting = actions.waitForSideChatActions(1);
    await jest.runAllTimersAsync();

    await expect(waiting).resolves.toBe(readyActions);
    expect(mockGetSideChatActions).toHaveBeenCalledTimes(9);
  });
});
