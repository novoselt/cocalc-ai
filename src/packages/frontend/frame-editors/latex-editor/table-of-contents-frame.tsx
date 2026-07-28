/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
LaTeX-specific table of contents rendering.  Chat-marker rows need live
message and unread counts, while headings and bookmarks retain the shared
TOC look and behavior.
*/

import { useEffect, useRedux } from "@cocalc/frontend/app-framework";
import {
  useAnchoredThreads,
  useResolvedAnchoredThreads,
} from "@cocalc/frontend/chat/anchors";
import {
  Icon,
  type IconName,
  Loading,
  Markdown,
  type TableOfContentsEntry,
  type TableOfContentsEntryList,
  type TableOfContentsEntryMap,
} from "@cocalc/frontend/components";
import { COLORS } from "@cocalc/util/theme";

import type { Actions as LatexActions } from "./actions";

export function LatexTableOfContents({
  font_size,
  actions,
}: {
  font_size: number;
  actions: LatexActions;
}) {
  useEffect(() => {
    setTimeout(() => actions.updateTableOfContents(true));
  }, []);
  const contents: TableOfContentsEntryList | undefined = useRedux([
    actions.name,
    "contents",
  ]);
  if (contents == null) {
    return <Loading theme="medium" />;
  }
  return (
    <LatexTOCBody
      contents={contents}
      fontSize={font_size}
      project_id={actions.project_id}
      masterPath={actions.path}
      scrollTo={actions.scrollToHeading.bind(actions)}
      openAnchorChat={(hash, path) => {
        void actions.openAnchorChat(
          hash,
          path === actions.path ? undefined : path,
        );
      }}
    />
  );
}

export function LatexTOCBody({
  contents,
  fontSize,
  project_id,
  masterPath,
  scrollTo,
  openAnchorChat,
  ifEmpty,
}: {
  contents: TableOfContentsEntryList | undefined;
  fontSize?: number;
  project_id: string;
  masterPath: string;
  scrollTo: (entry: TableOfContentsEntry) => void;
  openAnchorChat?: (hash: string, path: string) => void;
  ifEmpty?: React.ReactNode;
}) {
  if (contents == null) {
    return <Loading theme="medium" />;
  }
  if (contents.size === 0 && ifEmpty != null) {
    return <>{ifEmpty}</>;
  }
  return (
    <div
      style={{
        overflowY: "auto",
        height: "100%",
        paddingTop: "15px",
        fontSize: `${fontSize ?? 14}px`,
      }}
    >
      {contents.map((entry) => {
        const extra = entry.get("extra") as
          | {
              get?: (key: string) => unknown;
              kind?: string;
              hash?: string;
              path?: string;
            }
          | undefined;
        const field = (key: "kind" | "hash" | "path") =>
          typeof extra?.get === "function" ? extra.get(key) : extra?.[key];
        const kind = field("kind");
        const hash = field("hash");
        if (kind === "chat" && typeof hash === "string") {
          const sourcePath = field("path");
          return (
            <ChatRow
              key={entry.get("id")}
              entry={entry}
              hash={hash}
              project_id={project_id}
              masterPath={masterPath}
              onScrollTo={() => scrollTo(entry.toJS())}
              onOpenChat={
                openAnchorChat
                  ? () =>
                      openAnchorChat(
                        hash,
                        typeof sourcePath === "string"
                          ? sourcePath
                          : masterPath,
                      )
                  : undefined
              }
            />
          );
        }
        return (
          <PlainRow
            key={entry.get("id")}
            entry={entry}
            onClick={() => scrollTo(entry.toJS())}
          />
        );
      })}
    </div>
  );
}

function PlainRow({
  entry,
  onClick,
}: {
  entry: TableOfContentsEntryMap;
  onClick: () => void;
}) {
  return (
    <div onClick={onClick} style={{ cursor: "pointer" }}>
      <RowHeader
        level={entry.get("level", 1)}
        value={entry.get("value")}
        icon={entry.get("icon")}
        iconColor={entry.get("iconColor")}
      />
    </div>
  );
}

function ChatRow({
  entry,
  hash,
  project_id,
  masterPath,
  onScrollTo,
  onOpenChat,
}: {
  entry: TableOfContentsEntryMap;
  hash: string;
  project_id: string;
  masterPath: string;
  onScrollTo: () => void;
  onOpenChat?: () => void;
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
  const hasUnread = !isStale && totalUnread > 0;
  const pillText = isStale
    ? "resolved"
    : hasUnread
      ? `${totalUnread} unread`
      : `${totalMessages} message${totalMessages === 1 ? "" : "s"}`;
  const pillClickable = !isStale && onOpenChat != null;
  return (
    <div
      onClick={onScrollTo}
      style={{
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        opacity: isStale ? 0.6 : 1,
      }}
      title={`Chat anchor ${hash}`}
    >
      <RowHeader
        level={entry.get("level", 6)}
        value={entry.get("value")}
        icon={entry.get("icon", "comment")}
        iconColor={entry.get("iconColor")}
      />
      <span
        title={
          isStale
            ? "Stale marker — its chat thread was resolved"
            : hasUnread
              ? `${totalUnread} unread of ${totalMessages}`
              : `${totalMessages} message${totalMessages === 1 ? "" : "s"}`
        }
        onClick={
          pillClickable
            ? (event) => {
                event.stopPropagation();
                onOpenChat();
              }
            : undefined
        }
        style={{
          display: "inline-block",
          marginLeft: 8,
          padding: "0 8px",
          borderRadius: 10,
          fontSize: "0.8em",
          lineHeight: 1.4,
          fontWeight: 500,
          fontStyle: isStale ? "italic" : "normal",
          backgroundColor: hasUnread ? COLORS.ANTD_RED : COLORS.GRAY_LL,
          color: hasUnread ? COLORS.GRAY_LLL : COLORS.GRAY_M,
          whiteSpace: "nowrap",
          cursor: pillClickable ? "pointer" : "default",
        }}
      >
        {pillText}
      </span>
    </div>
  );
}

function RowHeader({
  level,
  value,
  icon,
  iconColor,
}: {
  level: 1 | 2 | 3 | 4 | 5 | 6;
  value: string;
  icon?: IconName;
  iconColor?: string;
}) {
  const normalizedLevel = Math.max(1, Math.min(6, level)) as
    | 1
    | 2
    | 3
    | 4
    | 5
    | 6;
  const indent = INDENTS[normalizedLevel];
  const headingUnicode =
    icon == null && normalizedLevel < 6 ? 0x00a7 : undefined;
  return (
    <div
      style={{
        whiteSpace: "nowrap",
        fontWeight: normalizedLevel === 1 ? "bold" : undefined,
      }}
    >
      <span style={{ width: indent.gutter, display: "inline-block" }}>
        {(icon != null || headingUnicode != null) && (
          <Icon
            name={icon}
            unicode={headingUnicode}
            aria-label={headingUnicode != null ? "Section" : undefined}
            style={{
              color: iconColor ?? COLORS.GRAY_M,
              marginLeft: indent.iconLeft,
            }}
          />
        )}
      </span>
      <a
        style={{
          display: "inline-block",
          marginBottom: "-1em",
          marginLeft: "10px",
        }}
      >
        <Markdown value={`&nbsp;${value}`} />
      </a>
    </div>
  );
}

const INDENTS: Record<
  1 | 2 | 3 | 4 | 5 | 6,
  { gutter: string; iconLeft: string }
> = {
  1: { gutter: "15px", iconLeft: "5px" },
  2: { gutter: "25px", iconLeft: "15px" },
  3: { gutter: "35px", iconLeft: "25px" },
  4: { gutter: "45px", iconLeft: "35px" },
  5: { gutter: "55px", iconLeft: "45px" },
  6: { gutter: "65px", iconLeft: "55px" },
};
