/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { JupyterActions } from "./actions";

describe("JupyterActions sync document lifecycle", () => {
  function createActions(syncdb: object): JupyterActions {
    const actions = new JupyterActions("undo-lifecycle-test", {
      getStore: jest.fn(() => undefined),
    } as any);
    (actions as any).syncdb = syncdb;
    return actions;
  }

  it.each(["undo", "redo"] as const)(
    "ignores %s after the sync document loses readiness",
    (operation) => {
      const invoke = jest.fn();
      const actions = createActions({
        isReady: () => false,
        [operation]: invoke,
      });

      const changed = actions[operation]();

      expect(changed).toBe(false);
      expect(invoke).not.toHaveBeenCalled();
    },
  );

  it.each(["undo", "redo"] as const)(
    "runs %s while the sync document is ready",
    (operation) => {
      const invoke = jest.fn();
      const actions = createActions({
        isReady: () => true,
        [operation]: invoke,
      });

      const changed = actions[operation]();

      expect(changed).toBe(true);
      expect(invoke).toHaveBeenCalledTimes(1);
    },
  );

  it("ignores deletes after the sync document loses readiness", () => {
    const deleteRecord = jest.fn();
    const actions = createActions({
      isReady: () => false,
      delete: deleteRecord,
    });

    actions._delete({ type: "cell", id: "cell-id" });

    expect(deleteRecord).not.toHaveBeenCalled();
  });

  it("uses a no-op logger after the client disappears", () => {
    const actions = createActions({});
    (actions as any)._state = "ready";
    (actions as any)._client = undefined;

    expect(() =>
      (actions as any).dbg("late-callback")("message"),
    ).not.toThrow();
  });

  it("accepts an empty runtime-state snapshot during reconnect", () => {
    const actions = createActions({});
    (actions as any).store = { get: () => ({}) };
    (actions as any).runtimeState = { getAll: () => undefined };

    expect(() => (actions as any).applyRuntimeCellsSnapshot()).not.toThrow();
  });
});
