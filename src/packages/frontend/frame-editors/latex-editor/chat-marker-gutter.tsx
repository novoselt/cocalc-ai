/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Gutter components rendered on lines of a `.tex` (or included sub-file)
that contain a `% chat: <hash>` marker or a `% bookmark: <text>` comment.

The chat icon mirrors the Jupyter per-cell chat UX: red when there are
unread messages for this anchor, gray otherwise, and muted when the
marker is *stale* (its hash matches a resolved thread and no live thread
exists -- typically a marker in a sub-file that wasn't open at resolve
time).  Clicking a live marker opens the side chat focused on the
anchor's thread; clicking a stale marker offers removing the leftover
comment from the source.

Callbacks are passed as props (not taken from useFrameContext) because
gutter markers for sub-files render inside the sub-file's own editor,
not the master latex editor's frame tree.
*/

import { Popconfirm } from "antd";

import {
  useAnchoredThreads,
  useResolvedAnchoredThreads,
} from "@cocalc/frontend/chat/anchors";
import { Icon, Tooltip } from "@cocalc/frontend/components";
import { COLORS } from "@cocalc/util/theme";

interface ChatMarkerGutterProps {
  hash: string;
  // File the marker lives in (master file or a sub-file).
  path: string;
  // Master file path -- this is what the side chat is anchored to.
  masterPath: string;
  project_id: string;
  openAnchorChat: (hash: string, path: string) => void;
  openAnchorChatThread: (threadKey: string) => void;
  removeStaleMarker: (hash: string, path: string) => void;
}

export function ChatMarkerGutter({
  hash,
  path,
  masterPath,
  project_id,
  openAnchorChat,
  openAnchorChatThread,
  removeStaleMarker,
}: ChatMarkerGutterProps) {
  const { threads, totalUnread } = useAnchoredThreads(
    project_id,
    masterPath,
    hash,
  );
  const { threads: resolvedThreads } = useResolvedAnchoredThreads(
    project_id,
    masterPath,
    hash,
  );
  const isStale = resolvedThreads.length > 0 && threads.length === 0;
  const hasUnread = totalUnread > 0;

  const icon = (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        cursor: "pointer",
        color: isStale
          ? COLORS.GRAY_L
          : hasUnread
            ? COLORS.ANTD_RED
            : COLORS.GRAY_M,
        opacity: isStale ? 0.6 : 1,
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (isStale) return;
        const newestUnread = threads.filter((t) => t.unreadCount > 0)[0];
        if (newestUnread) {
          openAnchorChatThread(newestUnread.key);
        } else {
          openAnchorChat(hash, path);
        }
      }}
    >
      <Icon name="comment" />
    </span>
  );

  if (isStale) {
    return (
      <Popconfirm
        title="This marker's chat thread was resolved."
        description="Remove the stale marker comment from the source?"
        okText="Remove"
        onConfirm={() => removeStaleMarker(hash, path)}
      >
        <span>
          <Tooltip
            title="Stale marker — its chat thread was resolved."
            placement="right"
          >
            {icon}
          </Tooltip>
        </span>
      </Popconfirm>
    );
  }

  return (
    <Tooltip
      title={
        hasUnread
          ? `Open chat thread for this anchor (${totalUnread} unread)`
          : "Open chat thread for this anchor"
      }
      placement="right"
    >
      {icon}
    </Tooltip>
  );
}

export function BookmarkGutter({ text }: { text: string }) {
  return (
    <Tooltip title={`Bookmark: ${text}`} placement="right">
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          color: COLORS.GRAY_M,
        }}
      >
        <Icon name="tag-outlined" />
      </span>
    </Tooltip>
  );
}

export function ChatMarkerInlineTail({
  hash,
  masterPath,
  project_id,
  onOpen,
  onConfirmResolve,
  onConfirmRemoveStale,
}: {
  hash: string;
  masterPath: string;
  project_id: string;
  onOpen: () => void;
  onConfirmResolve: () => void;
  onConfirmRemoveStale: () => void;
}) {
  const { threads, totalMessages, totalUnread } = useAnchoredThreads(
    project_id,
    masterPath,
    hash,
  );
  const { threads: resolvedThreads } = useResolvedAnchoredThreads(
    project_id,
    masterPath,
    hash,
  );
  const isStale = resolvedThreads.length > 0 && threads.length === 0;
  const hasUnread = totalUnread > 0;
  const pillText =
    isStale || totalMessages <= 0
      ? undefined
      : hasUnread
        ? `${totalUnread} unread`
        : `${totalMessages} message${totalMessages === 1 ? "" : "s"}`;

  return (
    <span
      style={{ display: "inline-flex", alignItems: "center", marginLeft: 4 }}
    >
      {pillText != null && (
        <Tooltip
          title={
            hasUnread ? `${totalUnread} unread of ${totalMessages}` : pillText
          }
          placement="top"
        >
          <span
            onMouseDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onOpen();
            }}
            style={{
              display: "inline-block",
              padding: "0 10px",
              borderRadius: 10,
              fontSize: "0.85em",
              lineHeight: 1.4,
              fontWeight: 500,
              cursor: "pointer",
              backgroundColor: hasUnread ? COLORS.ANTD_RED : COLORS.GRAY_LL,
              color: hasUnread ? COLORS.GRAY_LLL : COLORS.GRAY_DD,
            }}
          >
            {pillText}
          </span>
        </Tooltip>
      )}
      {isStale && (
        <Tooltip title="Stale marker — chat is resolved" placement="top">
          <span
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              display: "inline-block",
              padding: "0 10px",
              borderRadius: 10,
              fontSize: "0.85em",
              lineHeight: 1.4,
              fontStyle: "italic",
              color: COLORS.GRAY_M,
              backgroundColor: COLORS.GRAY_LL,
            }}
          >
            resolved
          </span>
        </Tooltip>
      )}
      <Popconfirm
        title={
          isStale ? "Remove stale marker?" : "Resolve chat and remove marker?"
        }
        description={
          isStale
            ? "The chat is already resolved. Remove this leftover marker?"
            : "Resolve the chat and remove every source marker with this ID?"
        }
        okText={isStale ? "Remove" : "Resolve"}
        cancelText="Cancel"
        onConfirm={isStale ? onConfirmRemoveStale : onConfirmResolve}
        placement="right"
      >
        <Tooltip
          title={
            isStale
              ? "Remove this stale marker"
              : "Resolve chat and remove marker"
          }
          placement="right"
        >
          <span
            onMouseDown={(event) => event.stopPropagation()}
            style={{
              display: "inline-block",
              cursor: "pointer",
              color: isStale ? COLORS.GRAY_L : COLORS.BS_GREEN_D,
              fontSize: isStale ? "0.9em" : "1.1em",
              marginLeft: 8,
              padding: "0 4px",
            }}
          >
            <Icon name={isStale ? "times-circle" : "check-circle"} />
          </span>
        </Tooltip>
      </Popconfirm>
    </span>
  );
}

// Plain-function wrappers so latex-editor/actions.ts (a .ts file, no JSX)
// can build the gutter components.
export function renderChatMarkerGutter(props: ChatMarkerGutterProps) {
  return <ChatMarkerGutter {...props} />;
}

export function renderBookmarkGutter(text: string) {
  return <BookmarkGutter text={text} />;
}
