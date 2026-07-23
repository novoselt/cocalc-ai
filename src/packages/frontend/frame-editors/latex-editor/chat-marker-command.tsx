/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Register the "Insert chat marker" and "Insert bookmark" commands for
LaTeX source frames.

Adds entries at the bottom of the Insert menu via a new `latex-chat`
group.  The commands' `isVisible` is gated on the actions having an
`insertChatMarker` / `insertBookmark` method, so they only appear for
editors that support them.
*/

import { defineMessage } from "react-intl";

import { menu } from "@cocalc/frontend/i18n";
import { addCommands } from "../frame-tree/commands/commands";
import { addMenus } from "../frame-tree/commands/menus";

addMenus({
  insert: {
    label: menu.insert,
    pos: 1.3,
    groups: ["latex-chat"],
  },
});

addCommands({
  insert_chat_marker: {
    group: "latex-chat",
    icon: "comment",
    label: defineMessage({
      id: "command.latex.insert_chat_marker.label",
      defaultMessage: "Chat",
      description: "Menu label for inserting a chat marker in a LaTeX doc",
    }),
    title: defineMessage({
      id: "command.latex.insert_chat_marker.title",
      defaultMessage:
        "Insert a chat anchor (% chat: [hash]) at the cursor and open a linked side-chat thread. Use inline after tex content or on its own line.",
      description: "Tooltip for inserting a chat marker in a LaTeX doc",
    }),
    isVisible: ({ props }) =>
      typeof (props.actions as any)?.insertChatMarker === "function",
    onClick: ({ props }) => {
      void (props.actions as any).insertChatMarker({});
    },
  },
  insert_bookmark: {
    group: "latex-chat",
    icon: "bookmark",
    label: defineMessage({
      id: "command.latex.insert_bookmark.label",
      defaultMessage: "Bookmark",
      description: "Menu label for inserting a bookmark in a LaTeX doc",
    }),
    title: defineMessage({
      id: "command.latex.insert_bookmark.title",
      defaultMessage:
        "Insert a collaborative bookmark (% bookmark: text) at the cursor. Appears in the Contents panel and lets collaborators jump there.",
      description: "Tooltip for inserting a bookmark in a LaTeX doc",
    }),
    isVisible: ({ props }) =>
      typeof (props.actions as any)?.insertBookmark === "function",
    onClick: ({ props }) => {
      void (props.actions as any).insertBookmark({});
    },
  },
});
