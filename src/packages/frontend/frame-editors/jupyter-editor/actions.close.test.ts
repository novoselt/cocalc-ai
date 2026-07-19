/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

jest.mock("@cocalc/frontend/jupyter/browser-actions", () => ({
  JupyterActions: class {},
}));

jest.mock("./jupyter-actions", () => ({
  create_jupyter_actions: jest.fn(),
  close_jupyter_actions: jest.fn(),
}));

import { EventEmitter } from "events";
import { JupyterEditorActions } from "./actions";
import { BaseEditorActions } from "../base-editor/actions-base";

describe("JupyterEditorActions.close", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("detaches base editor syncdoc recovery before closing jupyter actions", () => {
    const order: string[] = [];
    jest
      .spyOn(BaseEditorActions.prototype, "close")
      .mockImplementation(function (this: any) {
        order.push("base");
      });

    const target = {
      syncConsoleTimer: undefined,
      close_jupyter_actions: jest.fn(() => {
        order.push("jupyter");
      }),
    } as any;

    JupyterEditorActions.prototype.close.call(target);

    expect(order).toEqual(["base", "jupyter"]);
  });
});

describe("JupyterEditorActions close-frame cleanup", () => {
  it("closes the notebook frame action synchronously before closing the file tab", () => {
    const store = new EventEmitter();
    const close = jest.fn();
    const target = {
      normalizeRemovedSingleDocFrames: jest.fn(),
      init_new_frame: jest.fn(),
      init_changes_state: jest.fn(),
      store,
      frame_actions: {
        "frame-1": { close },
      },
    } as any;

    JupyterEditorActions.prototype._init2.call(target);

    store.emit("close-frame", { id: "frame-1", closingFile: true });

    expect(close).toHaveBeenCalledTimes(1);
    expect(target.frame_actions["frame-1"]).toBeUndefined();
  });
});

describe("JupyterEditorActions removed single-document frame migration", () => {
  it("converts saved experimental frames to the standard notebook", () => {
    const frameTypes = {
      classic: "jupyter_cell_notebook",
      experimental: "jupyter_slate_single_doc_notebook",
      legacy: "jupyter-singledoc",
    };
    const set_frame_type = jest.fn();
    const target = {
      _get_leaf_ids: () => frameTypes,
      _get_frame_node: (id: keyof typeof frameTypes) => ({
        get: () => frameTypes[id],
      }),
      set_frame_type,
    } as any;

    (
      JupyterEditorActions.prototype as any
    ).normalizeRemovedSingleDocFrames.call(target);

    expect(set_frame_type.mock.calls).toEqual([
      ["experimental", "jupyter_cell_notebook"],
      ["legacy", "jupyter_cell_notebook"],
    ]);
  });
});
