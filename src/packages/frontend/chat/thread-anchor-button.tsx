/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Jump-to-anchor button shown in the header of an anchored thread in the
side chat.  Hides itself when the thread has no anchor or the document's
editor does not implement the anchor adapter (see chat/anchors.ts).
*/

import { Button } from "antd";

import { Icon, Tooltip } from "@cocalc/frontend/components";

import type { ChatActions } from "./actions";
import type { AnchorEditorActions } from "./anchors";

export function ThreadAnchorButton({
  actions,
  threadKey,
}: {
  actions: ChatActions;
  threadKey?: string | null;
}) {
  if (!threadKey) return null;
  const metadata = actions.getThreadMetadata(threadKey, {
    threadId: threadKey,
  });
  const anchor = metadata?.anchor;
  const editorActions = actions.frameTreeActions as
    | AnchorEditorActions
    | undefined;
  if (anchor == null || editorActions?.jumpToAnchor == null) {
    return null;
  }
  const label =
    editorActions.getAnchorJumpLabel?.(anchor.id) ??
    editorActions.getAnchorLabel?.(anchor.id) ??
    anchor.id;
  return (
    <Tooltip title={`Jump to ${label} in the document`} placement="top">
      <Button
        size="small"
        type="text"
        style={{ marginLeft: "auto", textTransform: "none", fontWeight: 400 }}
        icon={<Icon name="external-link" />}
        onClick={() => {
          editorActions.jumpToAnchor?.(anchor.id);
        }}
      >
        {label}
      </Button>
    </Tooltip>
  );
}
