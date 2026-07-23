/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Resolve flow for anchored threads (collaborative TODOs):

- ThreadResolveButton: green check in the single-thread header of the
  side chat.  Only shown when the thread is anchored and the document
  editor implements resolveChatMarker (LaTeX).  Confirming resolves the
  thread(s) for the anchor and removes the marker(s) from the source.
- ThreadResolvedChip: shown instead once the thread is resolved --
  "Resolved by <name> on <date>", with the anchor's former label.
*/

import { Button, Popconfirm, Tag } from "antd";

import { redux } from "@cocalc/frontend/app-framework";
import { Icon, Tooltip } from "@cocalc/frontend/components";
import { COLORS } from "@cocalc/util/theme";

import type { ChatActions } from "./actions";
import type { AnchorEditorActions } from "./anchors";

export function ThreadResolveButton({
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
  if (metadata?.resolved != null) {
    return <ThreadResolvedChip resolved={metadata.resolved} />;
  }
  const anchor = metadata?.anchor;
  const editorActions = actions.frameTreeActions as
    | AnchorEditorActions
    | undefined;
  if (anchor == null || editorActions?.resolveChatMarker == null) {
    return null;
  }
  return (
    <Popconfirm
      title="Resolve this discussion?"
      description="Marks the thread resolved and removes its % chat marker from the source."
      okText="Resolve"
      onConfirm={() => {
        editorActions.resolveChatMarker?.(anchor.id);
      }}
    >
      <span>
        <Tooltip
          title="Resolve: mark this discussion as done and remove its marker from the document"
          placement="top"
        >
          <Button
            size="small"
            type="text"
            style={{ color: COLORS.ANTD_GREEN }}
            icon={<Icon name="check" />}
          />
        </Tooltip>
      </span>
    </Popconfirm>
  );
}

function ThreadResolvedChip({
  resolved,
}: {
  resolved: { account_id: string; at: string; label?: string };
}) {
  const name =
    redux.getStore("users")?.get_name?.(resolved.account_id) ?? "collaborator";
  const when = resolved.at ? new Date(resolved.at).toLocaleString() : "";
  return (
    <Tooltip
      title={`Resolved by ${name}${when ? ` on ${when}` : ""}${
        resolved.label ? ` — was anchored at ${resolved.label}` : ""
      }`}
      placement="top"
    >
      <Tag color="green" style={{ marginLeft: "5px", textTransform: "none" }}>
        <Icon name="check" /> resolved
      </Tag>
    </Tooltip>
  );
}
