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
import type { ReactNode } from "react";

import { Icon, Tip, Tooltip } from "@cocalc/frontend/components";
import { COLORS } from "@cocalc/util/theme";

import type { ChatActions } from "./actions";
import type { AnchorEditorActions } from "./anchors";

export function ThreadAnchorButton({
  actions,
  threadKey,
  label: labelOverride,
}: {
  actions: ChatActions;
  threadKey?: string | null;
  label?: ReactNode;
}) {
  if (!threadKey) return labelOverride ?? null;
  const metadata = actions.getThreadMetadata(threadKey, {
    threadId: threadKey,
  });
  const anchor = metadata?.anchor;
  const editorActions = actions.frameTreeActions as
    | AnchorEditorActions
    | undefined;
  if (anchor == null || editorActions?.jumpToAnchor == null) {
    return labelOverride ?? null;
  }
  const anchorState = editorActions.getAnchorState?.(anchor.id, anchor.path);
  if (
    anchorState === "missing" ||
    (anchorState == null &&
      editorActions.canJumpToAnchor?.(anchor.id, anchor.path) === false)
  ) {
    const message =
      editorActions.getMissingAnchorMessage?.(anchor.id) ??
      "This anchor no longer exists";
    return (
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
        {labelOverride ?? anchor.id}
        <Tip title={message} placement="top">
          <span
            aria-label={message}
            style={{
              color: COLORS.ANTD_RED,
              display: "inline-flex",
              alignItems: "center",
            }}
          >
            <Icon name="trash" />
          </span>
        </Tip>
      </span>
    );
  }
  // A label resolver returning undefined means the target no longer exists
  // (e.g. a Jupyter cell was deleted or a LaTeX marker was removed). Keep the
  // stored thread title visible, but do not offer a jump into the void.
  let anchorLabel: string | undefined;
  if (editorActions.getAnchorJumpLabel != null) {
    anchorLabel = editorActions.getAnchorJumpLabel(anchor.id, anchor.path);
    if (anchorLabel == null && anchorState !== "unloaded") {
      return labelOverride ?? null;
    }
  } else if (editorActions.getAnchorLabel != null) {
    anchorLabel = editorActions.getAnchorLabel(anchor.id, anchor.path);
    if (anchorLabel == null && anchorState !== "unloaded") {
      return labelOverride ?? null;
    }
  }
  const label = labelOverride ?? anchorLabel ?? anchor.id;
  return (
    <Tooltip
      title={
        anchorState === "unloaded"
          ? `Open the anchor's subfile and locate ${label}`
          : `Jump to ${label} in the document`
      }
      placement="top"
    >
      <Button
        size="small"
        type="text"
        style={{
          height: "auto",
          padding: 0,
          color: "inherit",
          fontSize: "inherit",
          fontWeight: "inherit",
          letterSpacing: "inherit",
          textTransform: "inherit",
        }}
        icon={<Icon name="external-link" />}
        onClick={() => {
          if (anchor.path == null) {
            editorActions.jumpToAnchor?.(anchor.id);
          } else {
            editorActions.jumpToAnchor?.(anchor.id, anchor.path);
          }
        }}
      >
        {label}
      </Button>
    </Tooltip>
  );
}
