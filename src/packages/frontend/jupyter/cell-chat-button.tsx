/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Per-cell chat: a button (and an always-visible unread badge) that opens
the document's side chat filtered to threads anchored to this cell.  The
anchor id is the cell's UUID; see @cocalc/frontend/chat/anchors.
*/

import type { MenuProps } from "antd";
import { Badge, Button, Dropdown } from "antd";
import { type MouseEvent, useMemo } from "react";

import { useAnchoredThreads } from "@cocalc/frontend/chat/anchors";
import type { AnchorEditorActions } from "@cocalc/frontend/chat/anchors";
import { Icon, Tooltip } from "@cocalc/frontend/components";
import { useFrameContext } from "@cocalc/frontend/frame-editors/frame-tree/frame-context";
import { COLORS } from "@cocalc/util/theme";

import { CODE_BAR_BTN_STYLE } from "./consts";

// Compact chat affordance used where the full cell controls are hidden.
// Cells with discussions retain an icon/count; the selected cell also keeps a
// subtle Chat label visible so anchored discussions are discoverable.
export function CellChatCompactButton({
  cellId,
  showIdleButton = false,
}: {
  cellId: string;
  showIdleButton?: boolean;
}) {
  const frameContext = useFrameContext();
  const { project_id, path } = frameContext;
  const { threads, totalMessages, totalUnread } = useAnchoredThreads(
    project_id,
    path,
    cellId,
  );
  if (totalMessages <= 0 && totalUnread <= 0 && !showIdleButton) return null;

  const newestUnread = threads.filter((t) => t.unreadCount > 0)[0];
  const handleClick = (e: MouseEvent<HTMLElement>) => {
    e.stopPropagation();
    const editorActions = frameContext.actions as AnchorEditorActions;
    if (newestUnread) {
      editorActions.openAnchorChatThread?.(newestUnread.key);
    } else {
      editorActions.openAnchorChat?.(cellId);
    }
  };

  const hasUnread = totalUnread > 0;
  const badgeCount = hasUnread ? totalUnread : totalMessages;
  const title = hasUnread
    ? `${totalUnread} unread cell chat message${totalUnread > 1 ? "s" : ""}`
    : totalMessages > 0
      ? `${totalMessages} cell chat message${totalMessages > 1 ? "s" : ""}`
      : "Discuss this cell in side chat";

  return (
    <Tooltip title={title}>
      <Badge
        size="small"
        count={badgeCount}
        color={hasUnread ? undefined : COLORS.GRAY_L}
      >
        <Button
          aria-label="Discuss this cell in side chat"
          size="small"
          type="text"
          onClick={handleClick}
          style={{
            ...CODE_BAR_BTN_STYLE,
            height: "auto",
            minWidth: showIdleButton ? undefined : 24,
            opacity: 0.7,
            paddingInline: showIdleButton ? undefined : 4,
          }}
        >
          <Icon name="comment" />
          {showIdleButton ? " Chat" : null}
        </Button>
      </Badge>
    </Tooltip>
  );
}

export function CellChatButton({
  cellId,
  onOpenChange,
}: {
  cellId: string;
  onOpenChange?: (open: boolean) => void;
}) {
  const frameContext = useFrameContext();
  const { project_id, path } = frameContext;
  const { threads, totalMessages, totalUnread } = useAnchoredThreads(
    project_id,
    path,
    cellId,
  );
  const editorActions = frameContext.actions as AnchorEditorActions;

  // The newest thread with unread messages -- what the main button opens.
  const newestUnreadThread = useMemo(
    () => threads.filter((t) => t.unreadCount > 0)[0] ?? null,
    [threads],
  );

  const handleMainClick = () => {
    if (newestUnreadThread) {
      editorActions.openAnchorChatThread?.(newestUnreadThread.key);
    } else {
      editorActions.openAnchorChat?.(cellId);
    }
  };

  const menuItems: MenuProps["items"] = [];
  for (const t of threads) {
    const hasUnread = t.unreadCount > 0;
    menuItems.push({
      key: t.key,
      label: (
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {t.label}
          {hasUnread ? (
            <Badge size="small" count={t.unreadCount} />
          ) : (
            <Badge size="small" count={t.messageCount} color={COLORS.GRAY_L} />
          )}
        </span>
      ),
      onClick: () => {
        editorActions.openAnchorChatThread?.(t.key);
      },
    });
  }
  if (threads.length > 0) {
    menuItems.push({ type: "divider" });
  }
  menuItems.push({
    key: "new-thread",
    icon: <Icon name="plus" />,
    label: "New Thread",
    onClick: () => {
      editorActions.openAnchorChatNewThread?.(cellId);
    },
  });

  // Badge: red with unread count if any unread, otherwise gray with total.
  const hasUnread = totalUnread > 0;
  const badgeCount = hasUnread ? totalUnread : totalMessages;
  const badgeColor = hasUnread ? undefined : COLORS.GRAY_L;

  return (
    <div>
      <Dropdown.Button
        size="small"
        type="text"
        trigger={["click"]}
        mouseLeaveDelay={1.5}
        icon={<Icon name="angle-down" />}
        onClick={handleMainClick}
        onOpenChange={onOpenChange}
        menu={{ items: menuItems }}
      >
        <Tooltip placement="top" title="Discuss this cell in side chat">
          <span style={{ ...CODE_BAR_BTN_STYLE, height: "auto" }}>
            <Icon name="comment" /> Chat
            {badgeCount > 0 && (
              <Badge
                size="small"
                count={badgeCount}
                color={badgeColor}
                style={{ marginLeft: 4 }}
              />
            )}
          </span>
        </Tooltip>
      </Dropdown.Button>
    </div>
  );
}
