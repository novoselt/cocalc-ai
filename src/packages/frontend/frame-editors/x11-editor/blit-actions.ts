/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  BaseEditorActions,
  type CodeEditorState,
} from "@cocalc/frontend/frame-editors/base-editor/actions-base";
import { openProjectDocs } from "@cocalc/frontend/docs/navigation";
import type { FrameTree } from "@cocalc/frontend/frame-editors/frame-tree/types";

export const GRAPHICAL_APPLICATIONS_HELP_SLUG =
  "terminal/graphical-applications";

export class Actions extends BaseEditorActions<CodeEditorState> {
  protected doctype = "none";

  _raw_default_frame_tree(): FrameTree {
    return { type: "x11" };
  }

  _init2(): void {}

  reload(_id: string): void {
    this.set_reload("x11", Date.now());
  }

  help(): void {
    openProjectDocs({
      projectId: this.project_id,
      slug: GRAPHICAL_APPLICATIONS_HELP_SLUG,
    });
  }
}
