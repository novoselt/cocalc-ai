/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

// Keep editor registration independent of the substantial ChatRoom UI graph.
export const CHATROOM_COMMANDS = [
  "decrease_font_size",
  "increase_font_size",
  "time_travel",
  "undo",
  "redo",
  "save",
  "help",
  "export_document",
  "codex",
  "scrollToBottom",
  "scrollToTop",
  "show_search",
  "terminal",
] as const;
