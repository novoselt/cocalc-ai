/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { JupyterActions } from "./actions";

describe("JupyterActions undo lifecycle", () => {
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

      actions[operation]();

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

      actions[operation]();

      expect(invoke).toHaveBeenCalledTimes(1);
    },
  );
});
