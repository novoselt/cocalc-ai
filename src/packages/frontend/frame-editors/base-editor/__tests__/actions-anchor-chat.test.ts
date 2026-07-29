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
});
