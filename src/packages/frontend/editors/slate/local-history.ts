/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { BaseEditor } from "slate";
import { HistoryEditor } from "slate-history";

interface UndoKeyboardEvent {
  altKey: boolean;
  ctrlKey: boolean;
  key: string;
  metaKey: boolean;
  shiftKey: boolean;
}

export function handleLocalHistoryHotkey(
  event: UndoKeyboardEvent,
  editor: BaseEditor,
  enabled: boolean,
): boolean {
  if (
    !enabled ||
    !HistoryEditor.isHistoryEditor(editor) ||
    event.altKey ||
    (!event.ctrlKey && !event.metaKey) ||
    event.key.toLowerCase() !== "z"
  ) {
    return false;
  }
  if (event.shiftKey) {
    HistoryEditor.redo(editor);
  } else {
    HistoryEditor.undo(editor);
  }
  return true;
}
