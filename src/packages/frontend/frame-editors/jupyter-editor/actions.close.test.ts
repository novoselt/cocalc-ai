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

  it("provides AI metadata defaults after Jupyter actions are removed", () => {
    const target = { jupyter_actions: undefined } as any;

    expect(
      JupyterEditorActions.prototype.languageModelGetLanguage.call(target),
    ).toBe("py");
    expect(
      JupyterEditorActions.prototype.languageModelExtraFileInfo.call(target),
    ).toBe("Jupyter notebook using the  kernel");
    expect(
      JupyterEditorActions.prototype.codexCodeDescription.call(target),
    ).toBe("Jupyter notebook using the  kernel");
  });
});

describe("JupyterEditorActions close-frame cleanup", () => {
  it("closes the notebook frame action synchronously before closing the file tab", () => {
    const store = new EventEmitter();
    const close = jest.fn();
    const target = {
      normalizeRemovedFrameTypes: jest.fn(),
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

describe("JupyterEditorActions removed frame type migration", () => {
  function targetFor(nodes: { [id: string]: { [key: string]: any } }): any {
    return {
      _get_leaf_ids: () => nodes,
      _get_frame_node: (id: string) => ({
        get: (key: string) => nodes[id][key],
      }),
      set_frame_type: jest.fn(),
      set_frame_data: jest.fn(),
    };
  }

  function migrate(target: any): void {
    (JupyterEditorActions.prototype as any).normalizeRemovedFrameTypes.call(
      target,
    );
  }

  it("converts saved experimental frames to the standard notebook", () => {
    const target = targetFor({
      classic: { type: "jupyter_cell_notebook" },
      experimental: { type: "jupyter_slate_single_doc_notebook" },
      legacy: { type: "jupyter-singledoc" },
    });

    migrate(target);

    expect(target.set_frame_type.mock.calls).toEqual([
      ["experimental", "jupyter_cell_notebook"],
      ["legacy", "jupyter_cell_notebook"],
    ]);
  });

  it("converts a saved Minimal frame to Studio instead of resetting the tree", () => {
    const target = targetFor({
      terminal: { type: "terminal" },
      renamed: { type: "jupyter_minimal" },
    });

    migrate(target);

    // Only the stale frame is touched, so the surrounding layout survives.
    expect(target.set_frame_type.mock.calls).toEqual([
      ["renamed", "jupyter_studio"],
    ]);
  });

  it("carries the saved width and reading state across the rename", () => {
    const target = targetFor({
      renamed: {
        type: "jupyter_minimal",
        "data-minimalLayout": "narrow",
        "data-zenMode": true,
      },
    });

    migrate(target);

    expect(target.set_frame_data).toHaveBeenCalledWith({
      id: "renamed",
      studioLayout: "narrow",
      readingMode: true,
    });
  });

  it("does not invent frame data the saved frame never had", () => {
    const target = targetFor({ renamed: { type: "jupyter_minimal" } });

    migrate(target);

    expect(target.set_frame_data).not.toHaveBeenCalled();
    expect(target.set_frame_type).toHaveBeenCalledWith(
      "renamed",
      "jupyter_studio",
    );
  });
});
