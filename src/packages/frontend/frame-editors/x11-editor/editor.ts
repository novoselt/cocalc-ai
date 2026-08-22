/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Top-level React component for an X Window
*/

import { set } from "@cocalc/util/misc";
import { createEditor } from "../frame-tree/editor";
import { EditorDescription } from "../frame-tree/types";
import { Blit } from "./blit";

export const x11: EditorDescription = {
  type: "x11",
  short: "Apps",
  name: "Graphical applications",
  icon: "window-restore",
  component: Blit,
  commands: set(["reload", "help"]),
} as const;

const EDITOR_SPEC = {
  x11,
} as const;

export const Editor = createEditor({
  format_bar: false,
  editor_spec: EDITOR_SPEC,
  display_name: "Graphical applications",
});
