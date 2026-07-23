/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Anchored chat threads: a thread in a document's side chat can be anchored
to a location inside that document.  The anchor id is opaque to chat:

- Jupyter notebooks anchor threads to a cell via the cell's UUID.
- LaTeX documents anchor threads to a "% chat: <hash>" comment in the
  source; the anchor id is the marker hash.

The anchor lives on the thread's chat-thread-config row (see
ChatThreadAnchor in @cocalc/chat).  Resolving a thread moves the anchor
id into resolved.anchorId so stale markers can still be recognized.
*/

import { useEffect, useMemo, useState } from "react";

import { useTypedRedux } from "@cocalc/frontend/app-framework";
import type { ChatThreadAnchor, ChatThreadResolvedMeta } from "@cocalc/chat";

import type { ChatActions } from "./actions";
import { ensureSideChatActions } from "./unread";
import { isChatPath } from "./paths";

// Editor actions adapter for anchored threads.  Frame editors that
// support anchored side-chat threads implement (a subset of) these
// methods; shared chat UI duck-types on them and hides affordances
// when a method is missing.
export interface AnchorEditorActions {
  // scroll/focus the document location of the anchor
  jumpToAnchor?: (anchorId: string) => void;
  // human label for the anchor, e.g. "Cell 3" or "section.tex:12"
  getAnchorLabel?: (anchorId: string) => string | undefined;
  // shorter label used for the jump button; falls back to getAnchorLabel
  getAnchorJumpLabel?: (anchorId: string) => string | undefined;
  // open the side chat showing the newest thread for this anchor
  // (creating an empty anchored thread when none exists)
  openAnchorChat?: (anchorId: string, path?: string) => void;
  // open the side chat with a fresh anchored thread
  openAnchorChatNewThread?: (anchorId: string, path?: string) => void;
  // open the side chat showing one specific thread
  openAnchorChatThread?: (threadKey: string) => void;
  // LaTeX only: resolve the thread(s) for a marker hash and remove the
  // marker(s) from the source
  resolveChatMarker?: (hash: string) => void;
}

function parseNonemptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed ? trimmed : undefined;
}

// Parse an anchor value from a thread-config row.  Tolerates immutable
// records and malformed data from other clients.
export function parseThreadAnchor(value: any): ChatThreadAnchor | undefined {
  if (value == null) return undefined;
  const obj = typeof value.toJS === "function" ? value.toJS() : value;
  if (typeof obj !== "object") return undefined;
  const id = parseNonemptyString(obj.id);
  if (id == null) return undefined;
  const anchor: ChatThreadAnchor = { id };
  const path = parseNonemptyString(obj.path);
  if (path != null) {
    anchor.path = path;
  }
  return anchor;
}

export function parseThreadResolved(
  value: any,
): ChatThreadResolvedMeta | undefined {
  if (value == null) return undefined;
  const obj = typeof value.toJS === "function" ? value.toJS() : value;
  if (typeof obj !== "object") return undefined;
  const anchorId = parseNonemptyString(obj.anchorId);
  if (anchorId == null) return undefined;
  const resolved: ChatThreadResolvedMeta = {
    account_id: parseNonemptyString(obj.account_id) ?? "",
    at: parseNonemptyString(obj.at) ?? "",
    anchorId,
  };
  const path = parseNonemptyString(obj.path);
  if (path != null) {
    resolved.path = path;
  }
  const label = parseNonemptyString(obj.label);
  if (label != null) {
    resolved.label = label;
  }
  return resolved;
}

export interface AnchoredThreadSummary {
  key: string; // thread key == thread_id
  label: string;
  messageCount: number;
  unreadCount: number;
  newestTime: number;
  anchor?: ChatThreadAnchor;
  resolved?: ChatThreadResolvedMeta;
}

export interface AnchoredThreadsInfo {
  threads: AnchoredThreadSummary[]; // newest first
  totalMessages: number;
  totalUnread: number;
  chatActions?: ChatActions;
}

export function computeAnchoredThreads({
  actions,
  anchorId,
  accountId,
  resolved,
}: {
  actions: ChatActions | undefined;
  anchorId: string;
  accountId: string | undefined;
  resolved: boolean;
}): AnchoredThreadsInfo {
  const info: AnchoredThreadsInfo = {
    threads: [],
    totalMessages: 0,
    totalUnread: 0,
    chatActions: actions,
  };
  const id = `${anchorId ?? ""}`.trim();
  if (!actions || !id) {
    return info;
  }
  const readStateReady = actions.isProjectReadStateReady?.() ?? false;
  const threadIndex = actions.getThreadIndex?.();
  for (const row of actions.listThreadConfigRows?.() ?? []) {
    const threadId = `${(row as any)?.thread_id ?? ""}`.trim();
    if (!threadId) continue;
    const rowResolved = parseThreadResolved((row as any)?.resolved);
    const rowAnchor = parseThreadAnchor((row as any)?.anchor);
    const matches = resolved
      ? rowResolved?.anchorId === id
      : rowResolved == null && rowAnchor?.id === id;
    if (!matches) continue;
    const entry = threadIndex?.get?.(threadId);
    const messageCount = entry?.messageCount ?? 0;
    let unreadCount = 0;
    if (!resolved && readStateReady && accountId && messageCount > 0) {
      const readCount = Math.max(
        0,
        actions.getThreadReadCount?.(threadId, accountId) ?? 0,
      );
      unreadCount = Math.max(messageCount - readCount, 0);
    }
    const name = parseNonemptyString((row as any)?.name);
    info.threads.push({
      key: threadId,
      label: name ?? "Discussion",
      messageCount,
      unreadCount,
      newestTime: entry?.newestTime ?? 0,
      anchor: rowAnchor,
      resolved: rowResolved,
    });
    info.totalMessages += messageCount;
    info.totalUnread += unreadCount;
  }
  info.threads.sort((a, b) => b.newestTime - a.newestTime);
  return info;
}

function useSideChatActions(
  project_id: string,
  path: string,
): { chatActions: ChatActions | undefined; chatVersion: number } {
  const [chatActions, setChatActions] = useState<ChatActions | undefined>();
  const [chatVersion, setChatVersion] = useState(0);

  useEffect(() => {
    if (!project_id || !path || isChatPath(path)) {
      setChatActions(undefined);
      return;
    }
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const acquire = () => {
      if (cancelled) return;
      try {
        setChatActions(ensureSideChatActions(project_id, path));
      } catch (err) {
        console.warn("failed to initialize side chat actions", {
          project_id,
          path,
          err,
        });
        setChatActions(undefined);
        retryTimer = setTimeout(acquire, 3000);
      }
    };
    acquire();
    return () => {
      cancelled = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
    };
  }, [project_id, path]);

  useEffect(() => {
    if (!chatActions?.store) {
      return;
    }
    const refresh = () => {
      setChatVersion((value) => value + 1);
    };
    chatActions.store.on("change", refresh);
    refresh();
    return () => {
      chatActions.store?.removeListener("change", refresh);
    };
  }, [chatActions]);

  return { chatActions, chatVersion };
}

// All live (unresolved) threads anchored to anchorId in the side chat
// of the given document path.
export function useAnchoredThreads(
  project_id: string,
  path: string,
  anchorId: string | undefined,
): AnchoredThreadsInfo {
  const account_id = useTypedRedux("account", "account_id");
  const { chatActions, chatVersion } = useSideChatActions(project_id, path);
  return useMemo(
    () =>
      computeAnchoredThreads({
        actions: chatActions,
        anchorId: anchorId ?? "",
        accountId: account_id,
        resolved: false,
      }),
    [chatActions, chatVersion, anchorId, account_id],
  );
}

// All resolved threads whose former anchor id is anchorId -- used to
// detect stale markers left in the source after a thread was resolved.
export function useResolvedAnchoredThreads(
  project_id: string,
  path: string,
  anchorId: string | undefined,
): AnchoredThreadsInfo {
  const account_id = useTypedRedux("account", "account_id");
  const { chatActions, chatVersion } = useSideChatActions(project_id, path);
  return useMemo(
    () =>
      computeAnchoredThreads({
        actions: chatActions,
        anchorId: anchorId ?? "",
        accountId: account_id,
        resolved: true,
      }),
    [chatActions, chatVersion, anchorId, account_id],
  );
}
