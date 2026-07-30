/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { EventEmitter } from "events";

const mockEnsureSideChatActions = jest.fn();

jest.mock("@cocalc/frontend/chat/unread", () => ({
  ensureSideChatActions: (...args) => mockEnsureSideChatActions(...args),
}));

jest.mock("@cocalc/frontend/frame-editors/generic/chat", () => ({
  chat: { type: "chat" },
}));

import { TextEditorActions } from "../actions-text";

describe("anchored side-chat readiness", () => {
  afterEach(() => {
    jest.useRealTimers();
    mockEnsureSideChatActions.mockReset();
  });

  it("waits for ready and associates the chat frame without polling", async () => {
    const syncdb = new EventEmitter() as any;
    let state = "init";
    syncdb.get_state = () => state;
    const readyActions = {
      syncdb,
      frameTreeActions: undefined,
      frameId: "",
    };
    mockEnsureSideChatActions.mockReturnValue(readyActions);

    const actions: any = Object.create(TextEditorActions.prototype);
    actions.project_id = "project-1";
    actions.path = "notes.tex";
    actions._openAnchorChatGeneration = 1;
    actions.isClosed = jest.fn(() => false);

    const waiting = actions.waitForSideChatActions(1, "chat-frame");
    expect(readyActions.frameTreeActions).toBe(actions);
    expect(readyActions.frameId).toBe("chat-frame");
    expect(syncdb.listenerCount("ready")).toBe(1);

    state = "ready";
    syncdb.emit("ready");

    await expect(waiting).resolves.toBe(readyActions);
    expect(mockEnsureSideChatActions).toHaveBeenCalledTimes(1);
    expect(syncdb.listenerCount("ready")).toBe(0);
  });

  it("drops a superseded request after readiness", async () => {
    const syncdb = new EventEmitter() as any;
    let state = "init";
    syncdb.get_state = () => state;
    mockEnsureSideChatActions.mockReturnValue({
      syncdb,
      frameTreeActions: undefined,
      frameId: "",
    });
    const actions: any = Object.create(TextEditorActions.prototype);
    actions.project_id = "project-1";
    actions.path = "notes.tex";
    actions._openAnchorChatGeneration = 1;
    actions.isClosed = jest.fn(() => false);

    const waiting = actions.waitForSideChatActions(1, "chat-frame");
    actions._openAnchorChatGeneration = 2;
    state = "ready";
    syncdb.emit("ready");

    await expect(waiting).resolves.toBeUndefined();
  });

  it("rebinds after the initial syncdb closes", async () => {
    const closedSyncdb = new EventEmitter() as any;
    closedSyncdb.get_state = () => "init";
    const readySyncdb = new EventEmitter() as any;
    readySyncdb.get_state = () => "ready";
    const readyActions = {
      syncdb: readySyncdb,
      frameTreeActions: undefined,
      frameId: "",
    };
    mockEnsureSideChatActions
      .mockReturnValueOnce({
        syncdb: closedSyncdb,
        frameTreeActions: undefined,
        frameId: "",
      })
      .mockReturnValueOnce(readyActions);
    const actions: any = Object.create(TextEditorActions.prototype);
    actions.project_id = "project-1";
    actions.path = "notes.tex";
    actions._openAnchorChatGeneration = 1;
    actions.isClosed = jest.fn(() => false);

    const waiting = actions.waitForSideChatActions(1, "chat-frame");
    closedSyncdb.emit("closed");

    await expect(waiting).resolves.toBe(readyActions);
    expect(mockEnsureSideChatActions).toHaveBeenCalledTimes(2);
    expect(readyActions.frameTreeActions).toBe(actions);
    expect(readyActions.frameId).toBe("chat-frame");
  });

  it("selects the explicit notification thread before scrolling", async () => {
    const chatActions = {
      syncdb: { get_state: () => "ready" },
      frameTreeActions: undefined,
      frameId: "",
      clearAllFilters: jest.fn(),
      setSelectedThread: jest.fn(),
      scrollToDate: jest.fn(),
    };
    mockEnsureSideChatActions.mockReturnValue(chatActions);
    const open_chat = jest.fn();
    const actions: any = Object.create(TextEditorActions.prototype);
    actions.project_id = "project-1";
    actions.path = "notebook.ipynb";
    actions._openAnchorChatGeneration = 0;
    actions.isClosed = jest.fn(() => false);
    actions.redux = {
      getProjectActions: () => ({ open_chat }),
    };
    actions.show_focused_frame_of_type = jest.fn(() => "chat-frame");

    await actions.gotoFragment({
      chat: "1785326400000",
      thread: "cell-thread-56",
    });

    expect(open_chat).toHaveBeenCalledWith({ path: "notebook.ipynb" });
    expect(chatActions.clearAllFilters).toHaveBeenCalledTimes(1);
    expect(chatActions.setSelectedThread).toHaveBeenCalledWith(
      "cell-thread-56",
    );
    expect(chatActions.scrollToDate).toHaveBeenCalledWith("1785326400000", {
      persistFragment: false,
    });
    expect(
      chatActions.setSelectedThread.mock.invocationCallOrder[0],
    ).toBeLessThan(chatActions.scrollToDate.mock.invocationCallOrder[0]);
  });
});
