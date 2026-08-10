/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { useSyncExternalStore } from "react";

import { get_local_storage, set_local_storage } from "@cocalc/frontend/misc";

export type LatexEditMode = "latex" | "rich";

export const LATEX_EDITOR_MODE_STORAGE_KEY = "latex-editor-mode";
const MODE_CHANGED_EVENT = "cocalc:latex-editor-mode-changed";
const DEFAULT_MODE: LatexEditMode = "latex";

export function getLatexEditMode(): LatexEditMode {
  const stored = get_local_storage(LATEX_EDITOR_MODE_STORAGE_KEY);
  return stored === "rich" || stored === "latex" ? stored : DEFAULT_MODE;
}

export function setLatexEditMode(mode: LatexEditMode): void {
  if (getLatexEditMode() === mode) return;
  set_local_storage(LATEX_EDITOR_MODE_STORAGE_KEY, mode);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(MODE_CHANGED_EVENT));
  }
}

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const handleStorage = (event: StorageEvent) => {
    if (event.key === LATEX_EDITOR_MODE_STORAGE_KEY) {
      onStoreChange();
    }
  };
  window.addEventListener(MODE_CHANGED_EVENT, onStoreChange);
  window.addEventListener("storage", handleStorage);
  return () => {
    window.removeEventListener(MODE_CHANGED_EVENT, onStoreChange);
    window.removeEventListener("storage", handleStorage);
  };
}

export function useLatexEditMode(): LatexEditMode {
  return useSyncExternalStore(subscribe, getLatexEditMode, () => DEFAULT_MODE);
}
