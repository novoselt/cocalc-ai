/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { act, renderHook } from "@testing-library/react";

import { delete_local_storage, set_local_storage } from "@cocalc/frontend/misc";

import {
  getLatexEditMode,
  LATEX_EDITOR_MODE_STORAGE_KEY,
  setLatexEditMode,
  useLatexEditMode,
} from "./mode";

describe("LaTeX editor mode", () => {
  beforeEach(() => {
    delete_local_storage(LATEX_EDITOR_MODE_STORAGE_KEY);
  });

  afterEach(() => {
    delete_local_storage(LATEX_EDITOR_MODE_STORAGE_KEY);
  });

  it("defaults to raw LaTeX", () => {
    expect(getLatexEditMode()).toBe("latex");
    expect(renderHook(useLatexEditMode).result.current).toBe("latex");
  });

  it("persists Rich Text mode and updates every mounted editor", () => {
    const first = renderHook(useLatexEditMode);
    const second = renderHook(useLatexEditMode);

    act(() => setLatexEditMode("rich"));

    expect(getLatexEditMode()).toBe("rich");
    expect(first.result.current).toBe("rich");
    expect(second.result.current).toBe("rich");
  });

  it("updates mounted editors when another browser tab changes the mode", () => {
    const editor = renderHook(useLatexEditMode);

    act(() => {
      set_local_storage(LATEX_EDITOR_MODE_STORAGE_KEY, "rich");
      window.dispatchEvent(
        new StorageEvent("storage", { key: LATEX_EDITOR_MODE_STORAGE_KEY }),
      );
    });

    expect(editor.result.current).toBe("rich");
  });
});
