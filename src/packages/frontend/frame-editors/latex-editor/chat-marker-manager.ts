/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Chat markers and bookmarks for the LaTeX editor.

A `% chat: <hash>` comment in the tex source anchors a thread in the side
chat.  We scan the master file (and each open sub-file) for markers on every
syncstring change, then render a gutter icon + badge on each marker line.
The per-anchor threads live in the master `.sage-chat`; their thread-config
rows carry `anchor.id = <hash>` and optionally `anchor.path = <sub-file>`.
See chat-markers.ts for the marker format and @cocalc/frontend/chat/anchors
for the thread side.

This is a delegate of the LaTeX editor Actions: it owns all chat-marker and
bookmark state, and reaches back through `this.actions` for editor-level
concerns (paths, store, frames).  Actions keeps thin forwarders for the
members that the shared chat UI duck-types (see @cocalc/frontend/chat/anchors).
*/

import { delay } from "awaiting";
import { message as antdMessage } from "antd";
import * as CodeMirror from "codemirror";
import { fromJS } from "immutable";
import { debounce } from "lodash";
import { normalize as path_normalize } from "path";
import * as React from "react";
import { createRoot, type Root } from "react-dom/client";
import { Icon, TableOfContentsEntry } from "@cocalc/frontend/components";
import {
  Actions as BaseActions,
  CodeEditorState,
} from "@cocalc/frontend/frame-editors/base-editor/actions-text";
import { hash_string, path_split } from "@cocalc/util/misc";
import { reuseInFlight } from "@cocalc/util/reuse-in-flight";
import type {
  BookmarkMarker,
  ChatMarker,
  InvalidChatMarker,
} from "./chat-markers";
import {
  buildBookmarkLine,
  buildInlineInsertion,
  buildMarkerLine,
  generateBookmarkText,
  generateMarkerHash,
  lineHasTexContent,
  removeMarkersForHash,
  replacementMarkerHash,
  scanBookmarks,
  scanInvalidMarkers,
  scanMarkers,
} from "./chat-markers";
import {
  BookmarkGutter,
  ChatMarkerGutter,
  ChatMarkerInlineTail,
  InvalidChatMarkerTail,
} from "./chat-marker-gutter";
import {
  parseThreadAnchor,
  parseThreadResolved,
} from "@cocalc/frontend/chat/anchors";
import {
  ensureSideChatActions,
  getExistingSideChatActions,
} from "@cocalc/frontend/chat/unread";
import { syncdocDiagnosticLog } from "@cocalc/frontend/syncdoc-diagnostics";
import { parseTableOfContents } from "./table-of-contents";
import type { Actions } from "./actions";

// CodeMirror gutter id for chat markers and bookmarks; must be listed in
// the cm frame's `gutters` in editor.ts and styled in styles/editor.css.
export const CHAT_GUTTER_ID = "CodeMirror-latex-chat";

export class ChatMarkerManager {
  constructor(private readonly actions: Actions) {}

  getAnchoredThreadRows(): any[] {
    try {
      return (
        getExistingSideChatActions(
          this.actions.project_id,
          this.actions.path,
        )?.listThreadConfigRows() ?? []
      );
    } catch {
      // Side chat can be between syncdb instances during reconnect. Its next
      // store/cache event will recompute the TOC.
      return [];
    }
  }

  getActiveAnchorsByPath(): Map<string, Set<string>> {
    const byPath = new Map<string, Set<string>>();
    for (const row of this.getAnchoredThreadRows()) {
      const archived =
        row?.archived === true ||
        row?.archived === "true" ||
        row?.archived === 1 ||
        row?.archived === "1";
      if (archived || parseThreadResolved(row?.resolved) != null) continue;
      const anchor = parseThreadAnchor(row?.anchor);
      if (anchor?.path == null) continue;
      const path =
        this.actions.canonical_paths[path_normalize(anchor.path)] ??
        anchor.path;
      if (path === this.actions.path) continue;
      let ids = byPath.get(path);
      if (ids == null) {
        ids = new Set();
        byPath.set(path, ids);
      }
      ids.add(anchor.id);
    }
    return byPath;
  }

  getAnchoredSubfilePaths(): Set<string> {
    return new Set(this.getActiveAnchorsByPath().keys());
  }

  // ===== Chat anchors =======================================================
  //
  // A `% chat: <hash>` comment in the tex source anchors a thread in the
  // side chat.  We scan the master file (and each open sub-file) for
  // markers on every syncstring change, then render a gutter icon + badge
  // on each marker line.  The per-anchor threads live in the master
  // `.sage-chat`; their thread-config rows carry `anchor.id = <hash>` and
  // optionally `anchor.path = <sub-file>`.  See chat-markers.ts for the
  // marker format and @cocalc/frontend/chat/anchors for the thread side.

  private _chatMarkerScanners: {
    [path: string]: { dispose: () => void; rescan: () => void };
  } = {};

  // CodeMirror owns gutter DOM, so keep one persistent React root per
  // CodeMirror pane.  Going through the editor's Redux gutter state makes
  // split panes compete for the same host and causes visible flicker.
  private _chatGutterHosts: {
    [path: string]: Map<
      CodeMirror.Editor,
      Array<{ host: HTMLElement; root: Root; line: number }>
    >;
  } = {};

  private _bookmarkGutterHosts: {
    [path: string]: Map<
      CodeMirror.Editor,
      Array<{ host: HTMLElement; root: Root; line: number }>
    >;
  } = {};

  private _bookmarkLines: { [path: string]: Set<number> } = {};

  private _cursorInsertHosts: {
    [path: string]: Map<
      CodeMirror.Editor,
      {
        host: HTMLElement;
        chatRoot: Root;
        bookmarkRoot: Root;
        currentHandle: CodeMirror.LineHandle | null;
      }
    >;
  } = {};

  private _cursorInsertBound = new WeakSet<CodeMirror.Editor>();
  private _chatClickHandlerInstalled = new WeakSet<CodeMirror.Editor>();
  private _chatKeybindingInstalled = new WeakSet<CodeMirror.Editor>();
  private _chatTailTrackingInstalled = new WeakSet<CodeMirror.Editor>();

  private _chatTextMarkers: {
    [path: string]: Map<CodeMirror.Editor, CodeMirror.TextMarker[]>;
  } = {};

  private _chatTailHosts: {
    [path: string]: Map<
      CodeMirror.Editor,
      Array<{
        bookmark: CodeMirror.TextMarker;
        host: HTMLElement;
        root: Root;
      }>
    >;
  } = {};

  private _chatStoreDispose?: () => void;
  private _chatMarkerStoreDispose?: () => void;
  ownedByParent = false;
  private _diskScannedPaths = new Set<string>();
  private _diskChatContentHashes = new Map<string, number>();
  private _diskChatAnchorSignatures = new Map<string, string>();
  diskSubfileHeadings = new Map<string, TableOfContentsEntry[]>();
  private _diskChatRead?: (path: string) => Promise<void>;
  private _diskChatScanRefresh?: ReturnType<typeof debounce>;
  private _diskChatScanForce = false;

  init(): void {
    if (
      this.actions.getParentFile() != null &&
      this.actions.getParentFile() !== this.actions.path
    ) {
      this.ownedByParent = true;
      return;
    }
    this._attachChatMarkerScanner(this.actions, this.actions.path);
    this._initChatAnchorLockListener();
    this.scheduleDiskScans();
    // Sub-files get picked up whenever the build discovers dependencies
    // (set_switch_to_files) or the store otherwise changes.
    const refreshScanners = debounce(
      () => {
        if (this.actions.isClosed()) return;
        this._refreshChatMarkerScanners();
      },
      1000,
      { leading: false, trailing: true },
    );
    this.actions.store.on("change", refreshScanners);
    this._chatMarkerStoreDispose = () => {
      this.actions.store.removeListener("change", refreshScanners);
      refreshScanners.cancel();
    };
  }

  /**
   * A subfile opened on its own briefly owns `<subfile>.sage-chat`. Threads
   * anchored there before the master claimed the file stay in that file and
   * are not reachable from the master's side chat afterwards. We deliberately
   * do not migrate them, so surface the case in diagnostics instead of
   * dropping it silently.
   */
  private _logAbandonedStandaloneChat(): void {
    try {
      const actions = getExistingSideChatActions(
        this.actions.project_id,
        this.actions.path,
      );
      if (actions == null) return;
      const anchored = actions
        .listThreadConfigRows()
        .filter(
          (row) => parseThreadAnchor((row as any)?.anchor) != null,
        ).length;
      if (anchored === 0) return;
      syncdocDiagnosticLog("latex subfile yielded anchored chat threads", {
        path: this.actions.path,
        parent_file: this.actions.getParentFile(),
        anchoredThreads: anchored,
      });
    } catch {
      // diagnostics only -- never block yielding ownership.
    }
  }

  yieldToParent(): void {
    if (this.ownedByParent) return;
    this.ownedByParent = true;
    this._diskChatScanRefresh?.cancel();
    this._diskChatScanRefresh = undefined;
    this.diskSubfileHeadings.clear();
    this._logAbandonedStandaloneChat();
    for (const handle of Object.values(this._chatMarkerScanners)) {
      handle.dispose();
    }
    this._chatMarkerScanners = {};
    this._disposeChatGutterUI();
    this._chatMarkerStoreDispose?.();
    this._chatMarkerStoreDispose = undefined;
    this._chatStoreDispose?.();
    this._chatStoreDispose = undefined;
  }

  private _refreshChatMarkerScanners(): void {
    const wanted = new Set<string>();
    for (const actions of this.actions.all_actions()) {
      const path = (actions as any).path;
      if (typeof path !== "string" || !path) continue;
      wanted.add(path);
      this._attachChatMarkerScanner(actions, path);
      this._ensureChatGutterUI(path);
    }
    for (const path of Object.keys(this._chatMarkerScanners)) {
      if (wanted.has(path)) continue;
      this._chatMarkerScanners[path].dispose();
      delete this._chatMarkerScanners[path];
      this._disposeChatStateForPath(path);
      const chatMarkers = this.actions.store.get("chat_markers");
      const invalidChatMarkers = this.actions.store.get("invalid_chat_markers");
      const chatBookmarks = this.actions.store.get("chat_bookmarks");
      this.actions.setState({
        chat_markers: chatMarkers?.delete(path),
        invalid_chat_markers: invalidChatMarkers?.delete(path),
        chat_bookmarks: chatBookmarks?.delete(path),
      });
    }
    this.scheduleDiskScans();
  }

  private _getDiskChatCandidates(): Map<string, Set<string>> {
    const candidates = this.getActiveAnchorsByPath();
    const switchToFiles = this.actions.store.get("switch_to_files");
    for (const path of (switchToFiles?.toJS() ?? []) as string[]) {
      if (
        path !== this.actions.path &&
        path.toLowerCase().endsWith(".tex") &&
        !candidates.has(path)
      ) {
        candidates.set(path, new Set());
      }
    }
    for (const path of [...candidates.keys()]) {
      if (this._chatMarkerScanners?.[path] != null) {
        candidates.delete(path);
      }
    }
    return candidates;
  }

  scheduleDiskScans(force: boolean = false): void {
    if (this.actions.isClosed() || this.ownedByParent) {
      return;
    }
    this._diskChatScanForce ||= force;
    this._diskChatScanRefresh ??= debounce(
      () => {
        const scanForce = this._diskChatScanForce;
        this._diskChatScanForce = false;
        void this._scanDiskChatSubfiles(scanForce);
      },
      500,
      { leading: false, trailing: true },
    );
    this._diskChatScanRefresh();
  }

  private async _scanDiskChatSubfiles(force: boolean = false): Promise<void> {
    if (this.actions.isClosed() || this.ownedByParent) {
      return;
    }
    const candidates = this._getDiskChatCandidates();
    this._cleanupDiskChatScans(candidates);
    const signatures = (this._diskChatAnchorSignatures ??= new Map());
    const read =
      this._diskChatRead ??
      (this._diskChatRead = reuseInFlight(
        this._readDiskChatSubfile.bind(this),
      ));
    const reads: Promise<void>[] = [];
    for (const [path, anchorIds] of candidates) {
      const signature = [...anchorIds].sort().join("\0");
      if (!force && signatures.get(path) === signature) continue;
      // Record attempts as well as successful scans. A missing/unreadable file
      // should not be hammered on every chat message; a build refresh forces a
      // retry, and a changed anchor signature retries automatically.
      signatures.set(path, signature);
      reads.push(read(path));
    }
    await Promise.all(reads);
  }

  private async _readDiskChatSubfile(path: string): Promise<void> {
    try {
      const fs = this.actions._get_project_actions()?.fs?.();
      if (typeof fs?.readFile !== "function") return;
      const raw = await fs.readFile(path, "utf8");
      if (
        this.actions.isClosed() ||
        this.ownedByParent ||
        this._chatMarkerScanners?.[path] != null ||
        !this._getDiskChatCandidates().has(path)
      ) {
        // A live editor may have attached while the disk read was in flight.
        // Its syncstring scan is authoritative, so discard this result.
        return;
      }
      const text =
        typeof raw === "string"
          ? raw
          : ((raw as any)?.toString?.("utf8") ?? `${raw ?? ""}`);
      const contentHash = hash_string(text);
      const hashes = (this._diskChatContentHashes ??= new Map());
      const diskPaths = (this._diskScannedPaths ??= new Set());
      const headings = (this.diskSubfileHeadings ??= new Map());
      if (diskPaths.has(path) && hashes.get(path) === contentHash) return;

      const chatMarkers =
        this.actions.store.get("chat_markers") ?? (fromJS({}) as any);
      const chatBookmarks =
        this.actions.store.get("chat_bookmarks") ?? (fromJS({}) as any);
      hashes.set(path, contentHash);
      diskPaths.add(path);
      headings.set(path, parseTableOfContents(text));
      this.actions.setState({
        chat_markers: chatMarkers.set(path, fromJS(scanMarkers(text))),
        chat_bookmarks: chatBookmarks.set(path, fromJS(scanBookmarks(text))),
      });
      this.actions.updateTableOfContents();
    } catch {
      // Keep a build-known file's header, but never fall back to config-only
      // marker guesses when its source cannot be read.
    }
  }

  private _cleanupDiskChatScans(candidates: Map<string, Set<string>>): void {
    const diskPaths = (this._diskScannedPaths ??= new Set());
    const hashes = (this._diskChatContentHashes ??= new Map());
    const signatures = (this._diskChatAnchorSignatures ??= new Map());
    const headings = (this.diskSubfileHeadings ??= new Map());
    let chatMarkers = this.actions.store.get("chat_markers");
    let chatBookmarks = this.actions.store.get("chat_bookmarks");
    let changed = false;
    for (const path of [...diskPaths]) {
      if (candidates.has(path) && this._chatMarkerScanners?.[path] == null) {
        continue;
      }
      diskPaths.delete(path);
      hashes.delete(path);
      signatures.delete(path);
      headings.delete(path);
      chatMarkers = chatMarkers?.delete(path);
      chatBookmarks = chatBookmarks?.delete(path);
      changed = true;
    }
    for (const path of [...signatures.keys()]) {
      if (!candidates.has(path)) signatures.delete(path);
    }
    if (changed) {
      this.actions.setState({
        chat_markers: chatMarkers,
        chat_bookmarks: chatBookmarks,
      });
      this.actions.updateTableOfContents();
    }
  }

  private _disposeChatStateForPath(path: string): void {
    for (const cache of [this._chatGutterHosts, this._bookmarkGutterHosts]) {
      const perCm = cache[path];
      if (perCm == null) continue;
      for (const [cm, entries] of perCm) {
        for (const entry of entries) {
          try {
            cm.setGutterMarker(entry.line, CHAT_GUTTER_ID, null);
            entry.root.unmount();
          } catch {
            // The CodeMirror pane may already be gone.
          }
        }
      }
      delete cache[path];
    }
    const cursorHosts = this._cursorInsertHosts[path];
    if (cursorHosts != null) {
      for (const [cm, entry] of cursorHosts) {
        try {
          if (entry.currentHandle != null) {
            cm.setGutterMarker(entry.currentHandle, CHAT_GUTTER_ID, null);
          }
          entry.chatRoot.unmount();
          entry.bookmarkRoot.unmount();
        } catch {
          // The CodeMirror pane may already be gone.
        }
      }
      delete this._cursorInsertHosts[path];
    }
    delete this._bookmarkLines[path];
    this._clearChatTextDecorations(path);
  }

  private _attachChatMarkerScanner(actions: any, path: string): void {
    if (this._chatMarkerScanners[path] != null) return;
    const syncstring = (actions as any)._syncstring;
    if (syncstring == null) return;
    // A mounted syncstring is authoritative over an optimistic disk read.
    this._diskScannedPaths?.delete(path);
    this._diskChatContentHashes?.delete(path);
    this._diskChatAnchorSignatures?.delete(path);
    this.diskSubfileHeadings?.delete(path);
    const scan = (publishNewInvalidMarkers: boolean) => {
      if (this.actions.isClosed()) return;
      if (syncstring.get_state?.() !== "ready") return;
      let text: string;
      try {
        // A local CodeMirror edit can move its gutter line handles before the
        // corresponding syncstring snapshot catches up. Rescanning that stale
        // snapshot briefly moves an already-correct icon back to its old line.
        // Prefer the mounted editor buffer so decorations always match the
        // source currently visible to the user.
        const liveCm = Object.values(
          ((actions as any)._cm ?? {}) as Record<string, CodeMirror.Editor>,
        ).find((candidate) => {
          const wrapper = candidate.getWrapperElement?.();
          return wrapper == null || wrapper.isConnected;
        });
        text = liveCm?.getValue() ?? syncstring.to_str() ?? "";
      } catch {
        // syncstring not ready yet -- a later change event will rescan.
        return;
      }
      const markers = scanMarkers(text);
      const scannedInvalidMarkers = scanInvalidMarkers(text);
      const previousInvalidMarkers = (this.actions.store
        .get("invalid_chat_markers")
        ?.get(path)
        ?.toJS() ?? []) as unknown as InvalidChatMarker[];
      // Invalid diagnostics are deliberately slower than valid marker
      // discovery. While the user is typing `% chat: subfile-123`, every
      // short prefix is temporarily invalid; rendering a widget at that
      // point interferes with the cursor. Existing diagnostics still clear
      // promptly once their exact source text is fixed or deleted.
      const invalidMarkers = publishNewInvalidMarkers
        ? scannedInvalidMarkers
        : scannedInvalidMarkers.filter((candidate) =>
            previousInvalidMarkers.some(
              (previous) =>
                previous.line === candidate.line &&
                previous.col === candidate.col &&
                previous.text === candidate.text,
            ),
          );
      const bookmarks = scanBookmarks(text);
      const previousMarkers = (this.actions.store
        .get("chat_markers")
        ?.get(path)
        ?.toJS() ?? []) as unknown as ChatMarker[];
      // Move a config-only thread to an edited marker id before publishing
      // the new source snapshot. Otherwise the chat header can observe the
      // old anchor against the new markers and classify it as deleted.
      this._reconcileEmptyAnchorThread(path, previousMarkers, markers);
      this.actions.setState({
        chat_markers: (
          this.actions.store.get("chat_markers") ?? (fromJS({}) as any)
        ).set(path, fromJS(markers)),
        invalid_chat_markers: (
          this.actions.store.get("invalid_chat_markers") ?? (fromJS({}) as any)
        ).set(path, fromJS(invalidMarkers)),
        chat_bookmarks: (
          this.actions.store.get("chat_bookmarks") ?? (fromJS({}) as any)
        ).set(path, fromJS(bookmarks)),
      });
      this._updateChatGutters(path, markers, bookmarks);
      this._refreshChatMarkerText(path);
      this._refreshCursorInsert(path);
      if (path !== this.actions.path) {
        // master changes already refresh the TOC via their own listener
        this.actions.updateTableOfContents();
      }
    };
    const debounced = debounce(() => scan(false), 300, {
      leading: false,
      trailing: true,
    });
    const debouncedInvalid = debounce(() => scan(true), 1200, {
      leading: false,
      trailing: true,
    });
    const onChange = () => {
      debounced();
      debouncedInvalid();
    };
    syncstring.on("change", onChange);
    const onReady = () => scan(true);
    syncstring.once("ready", onReady);
    this._chatMarkerScanners[path] = {
      dispose: () => {
        debounced.cancel();
        debouncedInvalid.cancel();
        syncstring.removeListener("change", onChange);
        syncstring.removeListener("ready", onReady);
      },
      rescan: () => scan(true),
    };
    scan(true);
    this._ensureChatGutterUI(path);
  }

  /**
   * cocalc-ai represents a not-yet-messaged anchor as a config-only thread,
   * whereas cocalc.com keeps a separate pending anchor.  Follow a direct
   * source edit of that marker id so the first eventual message is attached
   * to the id the document actually contains.
   */
  private _reconcileEmptyAnchorThread(
    path: string,
    previous: ChatMarker[],
    next: ChatMarker[],
  ): void {
    const chatActions = this._getChatActionsForMarkerReconciliation();
    if (chatActions == null) return;
    const selectedKey = `${
      chatActions.frameTreeActions?._get_frame_data?.(
        chatActions.frameId,
        "selectedThreadKey",
      ) ??
      chatActions.store?.get("selectedThreadKey") ??
      ""
    }`;
    if (!selectedKey || selectedKey === "0") return;
    const row = chatActions
      .listThreadConfigRows()
      .find((candidate) => candidate?.thread_id === selectedKey);
    if (row == null || parseThreadResolved(row.resolved) != null) return;
    const anchor = parseThreadAnchor(row.anchor);
    if (anchor == null || (anchor.path ?? this.actions.path) !== path) return;
    if (
      (chatActions.getThreadIndex().get(selectedKey)?.messageCount ?? 0) !== 0
    ) {
      return;
    }
    const replacement = replacementMarkerHash(previous, next, anchor.id);
    if (replacement == null) return;
    if (
      !chatActions.setThreadAnchor(selectedKey, {
        id: replacement,
        ...(anchor.path ? { path: anchor.path } : undefined),
      })
    ) {
      return;
    }
    const location = next.find((marker) => marker.hash === replacement);
    const label =
      location == null
        ? (this.getAnchorLabel(replacement) ?? replacement)
        : `${replacement} (${path_split(path).tail}:${location.line + 1})`;
    chatActions.renameThread(selectedKey, label);
  }

  private _getChatActionsForMarkerReconciliation():
    | ReturnType<typeof ensureSideChatActions>
    | undefined {
    try {
      return ensureSideChatActions(this.actions.project_id, this.actions.path);
    } catch {
      return undefined;
    }
  }

  private _updateChatGutters(
    path: string,
    markers: ChatMarker[],
    bookmarks: BookmarkMarker[],
  ): void {
    const actions = this._actionsForChatPath(path);
    if (actions == null) return;
    const cms = Object.values(
      ((actions as any)._cm ?? {}) as Record<string, CodeMirror.Editor>,
    );
    if (cms.length === 0) return;

    const openAnchorChat = (hash: string, markerPath: string) => {
      void this.actions.openAnchorChat(
        hash,
        markerPath === this.actions.path ? undefined : markerPath,
      );
    };
    const openAnchorChatThread = (threadKey: string) => {
      void this.actions.openAnchorChatThread(threadKey);
    };
    const removeStaleMarker = (hash: string, markerPath: string) => {
      void this._removeChatMarkersForHash(markerPath, hash);
    };

    const chatTargets: Array<{ line: number; hash: string }> = [];
    const seenChatLines = new Set<number>();
    for (const marker of markers) {
      if (seenChatLines.has(marker.line)) continue;
      seenChatLines.add(marker.line);
      chatTargets.push({ line: marker.line, hash: marker.hash });
    }
    const seenBookmarkLines = new Set<number>();
    const bookmarkTargets: Array<{ line: number; text: string }> = [];
    for (const bookmark of bookmarks) {
      if (seenBookmarkLines.has(bookmark.line)) continue;
      seenBookmarkLines.add(bookmark.line);
      bookmarkTargets.push({ line: bookmark.line, text: bookmark.text });
    }
    const occupiedGutterLines = new Set([
      ...seenChatLines,
      ...seenBookmarkLines,
    ]);
    this._bookmarkLines[path] = seenBookmarkLines;
    this._updateNativeGutterHosts({
      path,
      cms,
      targets: chatTargets,
      cache: this._chatGutterHosts,
      protectedLines: occupiedGutterLines,
      render: (root, target) => {
        root.render(
          React.createElement(ChatMarkerGutter, {
            hash: target.hash,
            path,
            masterPath: this.actions.path,
            project_id: this.actions.project_id,
            openAnchorChat,
            openAnchorChatThread,
            removeStaleMarker,
          }),
        );
      },
    });
    this._updateNativeGutterHosts({
      path,
      cms,
      targets: bookmarkTargets,
      cache: this._bookmarkGutterHosts,
      protectedLines: occupiedGutterLines,
      render: (root, target) => {
        root.render(React.createElement(BookmarkGutter, { text: target.text }));
      },
    });
  }

  private _actionsForChatPath(
    path: string,
  ): BaseActions<CodeEditorState> | undefined {
    const actions =
      path === this.actions.path
        ? this.actions
        : this.actions.redux.getEditorActions(
            this.actions.project_id,
            path_normalize(path),
          );
    if (actions == null || (actions as any)._state === "closed") {
      return undefined;
    }
    return actions as BaseActions<CodeEditorState>;
  }

  private _updateNativeGutterHosts<T extends { line: number }>({
    path,
    cms,
    targets,
    cache,
    protectedLines,
    render,
  }: {
    path: string;
    cms: CodeMirror.Editor[];
    targets: T[];
    cache: {
      [path: string]: Map<
        CodeMirror.Editor,
        Array<{ host: HTMLElement; root: Root; line: number }>
      >;
    };
    protectedLines: ReadonlySet<number>;
    render: (root: Root, target: T) => void;
  }): void {
    const perCm = cache[path] ?? (cache[path] = new globalThis.Map());
    const liveCms = new Set(cms);
    for (const staleCm of [...perCm.keys()]) {
      if (liveCms.has(staleCm)) continue;
      for (const entry of perCm.get(staleCm) ?? []) {
        entry.root.unmount();
      }
      perCm.delete(staleCm);
    }
    for (const cm of cms) {
      const existing = perCm.get(cm) ?? [];
      const fresh: Array<{ host: HTMLElement; root: Root; line: number }> = [];
      for (let i = 0; i < targets.length; i++) {
        const target = targets[i];
        const reused = existing[i];
        const host = reused?.host ?? document.createElement("span");
        const root = reused?.root ?? createRoot(host);
        render(root, target);
        if (
          reused != null &&
          reused.line !== target.line &&
          !protectedLines.has(reused.line)
        ) {
          cm.setGutterMarker(reused.line, CHAT_GUTTER_ID, null);
        }
        cm.setGutterMarker(target.line, CHAT_GUTTER_ID, host);
        fresh.push({ host, root, line: target.line });
      }
      for (let i = targets.length; i < existing.length; i++) {
        const entry = existing[i];
        if (!protectedLines.has(entry.line)) {
          cm.setGutterMarker(entry.line, CHAT_GUTTER_ID, null);
        }
        entry.root.unmount();
      }
      perCm.set(cm, fresh);
    }
  }

  private _ensureChatGutterUI(path: string, retries = 8): void {
    if (this.actions.isClosed()) return;
    const actions = this._actionsForChatPath(path);
    const cms = Object.values(
      ((actions as any)?._cm ?? {}) as Record<string, CodeMirror.Editor>,
    );
    if (cms.length === 0) {
      if (retries > 0) {
        setTimeout(() => this._ensureChatGutterUI(path, retries - 1), 250);
      }
      return;
    }
    const perCm =
      this._cursorInsertHosts[path] ??
      (this._cursorInsertHosts[path] = new globalThis.Map());
    const liveCms = new Set(cms);
    for (const staleCm of [...perCm.keys()]) {
      if (liveCms.has(staleCm)) continue;
      const stale = perCm.get(staleCm);
      stale?.chatRoot.unmount();
      stale?.bookmarkRoot.unmount();
      perCm.delete(staleCm);
    }
    for (const cm of cms) {
      this._ensureChatMarkerClickHandler(cm, path);
      this._ensureChatKeybindings(cm, path);
      this._ensureChatTailTracking(cm, path);
      if (!perCm.has(cm)) {
        const host = document.createElement("span");
        host.className = "cc-chat-cursor-insert";
        host.addEventListener("mousedown", (event) => {
          event.preventDefault();
          event.stopPropagation();
        });
        const makeIcon = (
          title: string,
          icon: "comment" | "tag-outlined",
          onClick: (line: number) => void,
        ): Root => {
          const child = document.createElement("span");
          child.title = title;
          child.addEventListener("click", (event) => {
            event.preventDefault();
            event.stopPropagation();
            const entry = this._cursorInsertHosts[path]?.get(cm);
            if (entry?.currentHandle == null) return;
            const line = cm.getLineNumber(entry.currentHandle);
            if (line != null) onClick(line);
          });
          host.appendChild(child);
          const root = createRoot(child);
          root.render(React.createElement(Icon, { name: icon }));
          return root;
        };
        const chatRoot = makeIcon(
          "Insert chat anchor before this line",
          "comment",
          (line) => void this._insertChatMarkerBeforeLine(path, line, cm),
        );
        const bookmarkRoot = makeIcon(
          "Insert bookmark before this line",
          "tag-outlined",
          (line) => this._insertBookmarkBeforeLine(path, line, cm),
        );
        perCm.set(cm, {
          host,
          chatRoot,
          bookmarkRoot,
          currentHandle: null,
        });
      }
      if (!this._cursorInsertBound.has(cm)) {
        this._cursorInsertBound.add(cm);
        cm.on("cursorActivity", () => this._refreshCursorInsert(path, cm));
      }
    }

    const markers = (this.actions.store
      .get("chat_markers")
      ?.get(path)
      ?.toJS() ?? []) as unknown as ChatMarker[];
    const bookmarks = (this.actions.store
      .get("chat_bookmarks")
      ?.get(path)
      ?.toJS() ?? []) as unknown as BookmarkMarker[];
    this._updateChatGutters(path, markers, bookmarks);
    this._refreshChatMarkerText(path);
    this._refreshCursorInsert(path);
  }

  private _ensureChatMarkerClickHandler(
    cm: CodeMirror.Editor,
    path: string,
  ): void {
    if (this._chatClickHandlerInstalled.has(cm)) return;
    this._chatClickHandlerInstalled.add(cm);
    cm.on("mousedown", (_editor, event) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey) return;
      const pos = cm.coordsChar(
        { left: event.clientX, top: event.clientY },
        "window",
      );
      for (const marker of cm.findMarksAt(pos)) {
        const hash = (marker as any).chatHash as string | undefined;
        if (typeof hash !== "string") continue;
        event.preventDefault();
        void this.actions.openAnchorChat(
          hash,
          path === this.actions.path ? undefined : path,
        );
        return;
      }
    });
  }

  private _ensureChatKeybindings(cm: CodeMirror.Editor, path: string): void {
    if (this._chatKeybindingInstalled.has(cm)) return;
    this._chatKeybindingInstalled.add(cm);
    cm.addKeyMap({
      "Shift-Ctrl-M": () => void this.insertChatMarker({ path, cm }),
      "Shift-Cmd-M": () => void this.insertChatMarker({ path, cm }),
      "Shift-Ctrl-B": () => void this.insertBookmark({ path, cm }),
      "Shift-Cmd-B": () => void this.insertBookmark({ path, cm }),
    });
  }

  /**
   * CodeMirror normally tracks bookmark widgets through local edits, but a
   * rapid sequence of line splits can briefly leave an inline widget painted
   * at its previous visual line until the debounced source scan rebuilds it.
   * The marker TextMarker itself moves synchronously. Use the post-operation
   * `changes` event, after CodeMirror has finalized every marker position, to
   * realign the pill without a transient jump from the old visual line.
   */
  private _ensureChatTailTracking(cm: CodeMirror.Editor, path: string): void {
    if (this._chatTailTrackingInstalled.has(cm)) return;
    this._chatTailTrackingInstalled.add(cm);
    cm.on("changes", (_editor, changes) => {
      let forceFromLine: number | undefined;
      for (const change of changes) {
        const insertedLineCount = change.text.length - 1;
        const removedLineCount = change.to.line - change.from.line;
        if (insertedLineCount === removedLineCount) continue;
        forceFromLine =
          forceFromLine == null
            ? change.from.line
            : Math.min(forceFromLine, change.from.line);
      }
      this._syncChatTailPositions(path, cm, forceFromLine);
    });
  }

  private _syncChatTailPositions(
    path: string,
    cm: CodeMirror.Editor,
    forceFromLine?: number,
  ): void {
    const markers = this._chatTextMarkers[path]?.get(cm);
    const tails = this._chatTailHosts[path]?.get(cm);
    if (markers == null || tails == null) return;
    const count = Math.min(markers.length, tails.length);
    for (let i = 0; i < count; i++) {
      const range = markers[i].find() as
        | { from: CodeMirror.Position; to: CodeMirror.Position }
        | undefined;
      if (range == null || !("to" in range)) continue;
      const current = tails[i].bookmark.find() as
        | CodeMirror.Position
        | undefined;
      const force = forceFromLine != null && range.to.line >= forceFromLine;
      if (
        !force &&
        current != null &&
        current.line === range.to.line &&
        current.ch === range.to.ch
      ) {
        continue;
      }
      const { host } = tails[i];
      tails[i].bookmark.clear();
      host.parentNode?.removeChild(host);
      tails[i].bookmark = cm.setBookmark(range.to, {
        widget: host,
        insertLeft: false,
        handleMouseEvents: true,
      });
    }
  }

  private _refreshCursorInsert(path: string, onlyCm?: CodeMirror.Editor): void {
    const perCm = this._cursorInsertHosts[path];
    if (perCm == null) return;
    const markerLines = new Set<number>(
      (
        (this.actions.store.get("chat_markers")?.get(path)?.toJS() ??
          []) as any[]
      ).map((marker) => marker.line),
    );
    const invalidMarkerLines = new Set<number>(
      (
        (this.actions.store.get("invalid_chat_markers")?.get(path)?.toJS() ??
          []) as any[]
      ).map((marker) => marker.line),
    );
    const occupied = new Set([
      ...markerLines,
      ...invalidMarkerLines,
      ...(this._bookmarkLines[path] ?? []),
    ]);
    for (const [cm, entry] of perCm) {
      if (onlyCm != null && cm !== onlyCm) continue;
      const line = cm.getCursor().line;
      const nextHandle = occupied.has(line) ? null : cm.getLineHandle(line);
      if (entry.currentHandle === nextHandle) continue;
      if (entry.currentHandle != null) {
        const oldLine = cm.getLineNumber(entry.currentHandle);
        if (oldLine != null && !occupied.has(oldLine)) {
          cm.setGutterMarker(entry.currentHandle, CHAT_GUTTER_ID, null);
        }
      }
      if (nextHandle != null) {
        cm.setGutterMarker(nextHandle, CHAT_GUTTER_ID, entry.host);
      }
      entry.currentHandle = nextHandle;
    }
  }

  private _anchorHasMessages(hash: string): boolean {
    try {
      const actions = ensureSideChatActions(
        this.actions.project_id,
        this.actions.path,
      );
      const threadIndex = actions.getThreadIndex();
      return actions
        .listAnchoredThreadKeys(hash)
        .some(
          (threadKey) => (threadIndex.get(threadKey)?.messageCount ?? 0) > 0,
        );
    } catch {
      return false;
    }
  }

  private _createChatTextMarker({
    cm,
    hash,
    path,
    from,
    to,
    locked,
  }: {
    cm: CodeMirror.Editor;
    hash: string;
    path: string;
    from: CodeMirror.Position;
    to: CodeMirror.Position;
    locked: boolean;
  }): CodeMirror.TextMarker {
    const marker = cm.markText(from, to, {
      className: locked
        ? "cc-chat-marker cc-chat-marker-locked"
        : "cc-chat-marker",
      clearOnEnter: false,
      // Keep the left edge outside the atom so the cursor can rest immediately
      // before `%` and insert text there. Protect the right edge: otherwise
      // Backspace from the next line can remove the newline and typing at the
      // old right edge can silently extend the hash outside the read-only
      // range, turning it into a new editable anchor.
      inclusiveLeft: false,
      inclusiveRight: locked,
      handleMouseEvents: false,
      readOnly: locked,
      atomic: locked,
      attributes: {
        title: locked
          ? "Open chat thread (locked — remove the marker to edit)"
          : "Open chat thread",
      },
    });
    (marker as any).chatHash = hash;
    (marker as any).chatPath = path;
    (marker as any).chatLocked = locked;
    return marker;
  }

  private _createInvalidChatTextMarker({
    cm,
    text,
    from,
    to,
  }: {
    cm: CodeMirror.Editor;
    text: string;
    from: CodeMirror.Position;
    to: CodeMirror.Position;
  }): CodeMirror.TextMarker {
    const marker = cm.markText(from, to, {
      className: "cc-chat-marker-invalid",
      clearOnEnter: false,
      inclusiveLeft: false,
      inclusiveRight: false,
      attributes: {
        title: "Invalid chat ID — edit this comment to fix it",
      },
    });
    (marker as any).invalidChatMarker = true;
    (marker as any).invalidChatText = text;
    return marker;
  }

  private _canReuseChatTextDecorations({
    existing,
    markers,
    invalidMarkers,
    path,
  }: {
    existing: CodeMirror.TextMarker[];
    markers: ChatMarker[];
    invalidMarkers: InvalidChatMarker[];
    path: string;
  }): boolean {
    if (existing.length !== markers.length + invalidMarkers.length) {
      return false;
    }
    for (let i = 0; i < markers.length; i++) {
      const decoration: any = existing[i];
      const range = decoration.find?.();
      if (
        range == null ||
        !("from" in range) ||
        (range.from.line === range.to.line && range.from.ch === range.to.ch) ||
        decoration.chatHash !== markers[i].hash ||
        decoration.chatPath !== path ||
        decoration.chatLocked !== this._anchorHasMessages(markers[i].hash)
      ) {
        return false;
      }
    }
    for (let i = 0; i < invalidMarkers.length; i++) {
      const decoration: any = existing[markers.length + i];
      const range = decoration.find?.();
      if (
        range == null ||
        !("from" in range) ||
        (range.from.line === range.to.line && range.from.ch === range.to.ch) ||
        decoration.invalidChatMarker !== true ||
        decoration.invalidChatText !== invalidMarkers[i].text
      ) {
        return false;
      }
    }
    return true;
  }

  private _sweepStaleChatTailHosts(
    cm: CodeMirror.Editor,
    liveTails: Array<{ host: HTMLElement }>,
  ): void {
    const wrapper = cm.getWrapperElement?.();
    if (wrapper == null) return;
    const liveHosts = new Set(liveTails.map(({ host }) => host));
    wrapper
      .querySelectorAll<HTMLElement>(".cc-chat-marker-tail-host")
      .forEach((host) => {
        if (!liveHosts.has(host)) {
          host.parentNode?.removeChild(host);
        }
      });
  }

  private _refreshChatMarkerText(path: string): void {
    const actions = this._actionsForChatPath(path);
    if (actions == null) return;
    const cms = Object.values(
      ((actions as any)._cm ?? {}) as Record<string, CodeMirror.Editor>,
    );
    if (cms.length === 0) return;
    const perCm =
      this._chatTextMarkers[path] ??
      (this._chatTextMarkers[path] = new globalThis.Map());
    const tailsPerCm =
      this._chatTailHosts[path] ??
      (this._chatTailHosts[path] = new globalThis.Map());
    const liveCms = new Set(cms);
    for (const staleCm of [...perCm.keys()]) {
      if (liveCms.has(staleCm)) continue;
      for (const marker of perCm.get(staleCm) ?? []) {
        marker.clear();
      }
      perCm.delete(staleCm);
    }
    for (const staleCm of [...tailsPerCm.keys()]) {
      if (liveCms.has(staleCm)) continue;
      for (const tail of tailsPerCm.get(staleCm) ?? []) {
        tail.bookmark.clear();
        tail.root.unmount();
      }
      tailsPerCm.delete(staleCm);
    }
    const markers = (this.actions.store
      .get("chat_markers")
      ?.get(path)
      ?.toJS() ?? []) as unknown as ChatMarker[];
    const invalidMarkers = (this.actions.store
      .get("invalid_chat_markers")
      ?.get(path)
      ?.toJS() ?? []) as unknown as InvalidChatMarker[];
    for (const cm of cms) {
      const existing = perCm.get(cm) ?? [];
      const oldTails = tailsPerCm.get(cm) ?? [];
      if (
        oldTails.length === markers.length + invalidMarkers.length &&
        this._canReuseChatTextDecorations({
          existing,
          markers,
          invalidMarkers,
          path,
        })
      ) {
        // CodeMirror has already moved both TextMarkers and bookmarks with
        // the edit. Preserve their React roots and unread state rather than
        // detaching every inline control on each debounced source rescan.
        this._syncChatTailPositions(path, cm);
        this._sweepStaleChatTailHosts(cm, oldTails);
        continue;
      }
      for (const marker of existing) {
        marker.clear();
      }
      const fresh: CodeMirror.TextMarker[] = [];
      const freshTails: Array<{
        bookmark: CodeMirror.TextMarker;
        host: HTMLElement;
        root: Root;
      }> = [];
      for (const marker of markers) {
        const lineText = cm.getLine(marker.line) ?? "";
        fresh.push(
          this._createChatTextMarker({
            cm,
            hash: marker.hash,
            path,
            from: { line: marker.line, ch: marker.col },
            to: { line: marker.line, ch: lineText.length },
            locked: this._anchorHasMessages(marker.hash),
          }),
        );
        const reused = oldTails[freshTails.length];
        const host = reused?.host ?? document.createElement("span");
        host.className = "cc-chat-marker-tail-host";
        const root = reused?.root ?? createRoot(host);
        root.render(
          React.createElement(ChatMarkerInlineTail, {
            hash: marker.hash,
            masterPath: this.actions.path,
            project_id: this.actions.project_id,
            onOpen: () => {
              void this.actions.openAnchorChat(
                marker.hash,
                path === this.actions.path ? undefined : path,
              );
            },
            onConfirmResolve: (expectsThread) =>
              this.resolveChatMarker(marker.hash, expectsThread),
            onConfirmRemoveStale: () =>
              void this._removeChatMarkersForHash(path, marker.hash),
          }),
        );
        reused?.bookmark.clear();
        host.parentNode?.removeChild(host);
        const bookmark = cm.setBookmark(
          { line: marker.line, ch: lineText.length },
          { widget: host, insertLeft: false, handleMouseEvents: true },
        );
        freshTails.push({ bookmark, host, root });
      }
      for (const marker of invalidMarkers) {
        const lineText = cm.getLine(marker.line) ?? "";
        fresh.push(
          this._createInvalidChatTextMarker({
            cm,
            text: marker.text,
            from: { line: marker.line, ch: marker.col },
            to: { line: marker.line, ch: lineText.length },
          }),
        );
        const reused = oldTails[freshTails.length];
        const host = reused?.host ?? document.createElement("span");
        host.className = "cc-chat-marker-tail-host";
        const root = reused?.root ?? createRoot(host);
        root.render(
          React.createElement(InvalidChatMarkerTail, { text: marker.text }),
        );
        reused?.bookmark.clear();
        host.parentNode?.removeChild(host);
        const bookmark = cm.setBookmark(
          { line: marker.line, ch: lineText.length },
          { widget: host, insertLeft: false, handleMouseEvents: true },
        );
        freshTails.push({ bookmark, host, root });
      }
      for (let i = freshTails.length; i < oldTails.length; i++) {
        oldTails[i].bookmark.clear();
        oldTails[i].root.unmount();
      }
      perCm.set(cm, fresh);
      tailsPerCm.set(cm, freshTails);

      // CodeMirror may leave a detached bookmark wrapper behind when a
      // marker changes identity during a rescan. Remove any tail host in
      // this pane that is not one of the hosts we just placed.
      this._sweepStaleChatTailHosts(cm, freshTails);
    }
  }

  private _refreshChatMarkerLocks(): void {
    for (const [path, perCm] of Object.entries(this._chatTextMarkers)) {
      for (const [cm, existing] of perCm) {
        const fresh: CodeMirror.TextMarker[] = [];
        const tails = this._chatTailHosts[path]?.get(cm) ?? [];
        const freshTails: typeof tails = [];
        for (let i = 0; i < existing.length; i++) {
          const marker = existing[i];
          const tail = tails[i];
          const range = marker.find() as
            | { from: CodeMirror.Position; to: CodeMirror.Position }
            | undefined;
          if (range == null || !("from" in range)) {
            marker.clear();
            tail?.bookmark.clear();
            tail?.root.unmount();
            continue;
          }
          if ((marker as any).invalidChatMarker === true) {
            fresh.push(marker);
            if (tail != null) freshTails.push(tail);
            continue;
          }
          const hash = (marker as any).chatHash as string | undefined;
          if (hash == null) {
            marker.clear();
            tail?.bookmark.clear();
            tail?.root.unmount();
            continue;
          }
          const locked = this._anchorHasMessages(hash);
          if ((marker as any).chatLocked === locked) {
            fresh.push(marker);
            if (tail != null) freshTails.push(tail);
            continue;
          }
          marker.clear();
          fresh.push(
            this._createChatTextMarker({
              cm,
              hash,
              path,
              from: range.from,
              to: range.to,
              locked,
            }),
          );
          if (tail != null) freshTails.push(tail);
        }
        perCm.set(cm, fresh);
        this._chatTailHosts[path]?.set(cm, freshTails);
      }
    }
  }

  private _initChatAnchorLockListener(retries = 40): void {
    if (this.actions.isClosed() || this.ownedByParent) {
      return;
    }
    let chatActions;
    try {
      chatActions = ensureSideChatActions(
        this.actions.project_id,
        this.actions.path,
      );
    } catch {
      if (retries > 0) {
        setTimeout(() => this._initChatAnchorLockListener(retries - 1), 250);
      }
      return;
    }
    const store = chatActions.store;
    if (store == null) {
      if (retries > 0) {
        setTimeout(() => this._initChatAnchorLockListener(retries - 1), 250);
      }
      return;
    }
    const refresh = debounce(
      () => {
        if (this.actions.isClosed()) return;
        this._refreshChatMarkerLocks();
        // A remote thread config can identify a marker in an unopened
        // subfile. Verify unopened candidates from disk before updating their
        // TOC rows; thread metadata alone includes deleted historical anchors.
        this.scheduleDiskScans();
        this.actions.updateTableOfContents();
      },
      150,
      { leading: true, trailing: true },
    );
    let subscribedMessageCache = chatActions.messageCache;
    const bindCurrentMessageCache = () => {
      const next = chatActions.messageCache;
      if (next === subscribedMessageCache) return;
      subscribedMessageCache?.removeListener?.("version", refresh);
      subscribedMessageCache = next;
      subscribedMessageCache?.on?.("version", refresh);
    };
    const onStoreChange = () => {
      bindCurrentMessageCache();
      refresh();
    };
    store.on("change", onStoreChange);
    // Remote messages update the shared message cache without necessarily
    // changing the Redux chat store.  Lock marker text as soon as that cache
    // publishes its new thread count.
    subscribedMessageCache?.on?.("version", refresh);
    const reconnect = () => {
      this._chatStoreDispose?.();
      this._chatStoreDispose = undefined;
      this._initChatAnchorLockListener();
    };
    chatActions.syncdb?.once?.("close", reconnect);
    this._chatStoreDispose = () => {
      store.removeListener("change", onStoreChange);
      subscribedMessageCache?.removeListener?.("version", refresh);
      chatActions.syncdb?.removeListener?.("close", reconnect);
      refresh.cancel();
    };
    refresh();
  }

  // All locations of a marker hash across the scanned files, in
  // (path, line) order with the master file first.
  public getAnchorLocations(hash: string): { path: string; line: number }[] {
    const chatMarkers = this.actions.store.get("chat_markers");
    if (chatMarkers == null) return [];
    const locations: { path: string; line: number }[] = [];
    const paths = chatMarkers.keySeq().toJS() as string[];
    paths.sort((a, b) =>
      a === this.actions.path
        ? -1
        : b === this.actions.path
          ? 1
          : a.localeCompare(b),
    );
    for (const path of paths) {
      const markers = (chatMarkers.get(path)?.toJS() ??
        []) as unknown as ChatMarker[];
      for (const m of markers) {
        if (m.hash === hash) {
          locations.push({ path, line: m.line });
        }
      }
    }
    return locations;
  }

  public getAnchorJumpLabel = (
    hash: string,
    recordedPath?: string,
  ): string | undefined => {
    const locations = this.getAnchorLocations(hash);
    if (locations.length === 0) {
      const path = this._getUnloadedAnchorPath(hash, recordedPath);
      return path == null ? undefined : path_split(path).tail;
    }
    if (locations.length > 1) {
      return `${locations.length} locations`;
    }
    const { path, line } = locations[0];
    return `${path_split(path).tail}:${line + 1}`;
  };

  public getAnchorLabel = (hash: string): string | undefined => {
    const jumpLabel = this.getAnchorJumpLabel(hash);
    if (jumpLabel == null) return hash;
    return `${hash} (${jumpLabel})`;
  };

  public canJumpToAnchor = (hash: string, recordedPath?: string): boolean => {
    return this.getAnchorState(hash, recordedPath) !== "missing";
  };

  public getMissingAnchorMessage = (_hash: string): string => {
    return "This chat marker was removed";
  };

  public getAnchorState = (
    hash: string,
    recordedPath?: string,
  ): "available" | "missing" | "unloaded" => {
    if (this.getAnchorLocations(hash).length > 0) {
      return "available";
    }
    return this._getUnloadedAnchorPath(hash, recordedPath) == null
      ? "missing"
      : "unloaded";
  };

  private _getUnloadedAnchorPath(
    hash: string,
    recordedPath?: string,
  ): string | undefined {
    if (
      recordedPath != null &&
      recordedPath !== this.actions.path &&
      !this.actions.store.get("chat_markers")?.has(recordedPath)
    ) {
      return recordedPath;
    }
    let chatActions;
    try {
      chatActions = ensureSideChatActions(
        this.actions.project_id,
        this.actions.path,
      );
    } catch {
      return;
    }
    for (const row of chatActions.listThreadConfigRows()) {
      if (parseThreadResolved(row?.resolved) != null) continue;
      const anchor = parseThreadAnchor(row?.anchor);
      if (
        anchor?.id === hash &&
        anchor.path != null &&
        anchor.path !== this.actions.path &&
        !this.actions.store.get("chat_markers")?.has(anchor.path)
      ) {
        return anchor.path;
      }
    }
  }

  public jumpToAnchor = async (
    hash: string,
    recordedPath?: string,
  ): Promise<void> => {
    const locations = this.getAnchorLocations(hash);
    if (locations.length === 0) {
      const path = this._getUnloadedAnchorPath(hash, recordedPath);
      if (path == null) return;
      const frameId = await this.switchFocusedSourceTo(path);
      if (frameId == null) return;
      for (let retries = 0; retries < 40; retries += 1) {
        this._refreshChatMarkerScanners();
        this._chatMarkerScanners[path]?.rescan();
        const loaded = this.getAnchorLocations(hash).find(
          (location) => location.path === path,
        );
        if (loaded != null) {
          await this.gotoSourceLine(path, loaded.line + 1, frameId);
          return;
        }
        await delay(100);
      }
      return;
    }
    const { path, line } = locations[0];
    const frameId = await this.switchFocusedSourceTo(path);
    if (frameId == null) return;
    await this.gotoSourceLine(path, line + 1, frameId);
  };

  async switchFocusedSourceTo(path: string): Promise<string | undefined> {
    const frameId =
      this.actions._get_most_recent_active_frame_id_of_type("cm") ??
      this.actions.show_focused_frame_of_type("cm");
    if (frameId == null) return;
    const currentPath =
      this.actions._get_frame_node(frameId)?.get("path") ?? this.actions.path;
    if (currentPath === path) {
      await this._waitForSourcePane(path, frameId);
      return frameId;
    }
    const switchedFrameId = await this.actions.switch_to_file(path, frameId);
    await this._waitForSourcePane(path, switchedFrameId);
    return switchedFrameId;
  }

  private async _waitForSourcePane(
    path: string,
    frameId: string,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start <= 15000) {
      if (this.actions.isClosed()) return;
      const actions: any = this._actionsForChatPath(path);
      const cm: CodeMirror.Editor | undefined = actions?._cm?.[frameId];
      const wrapper = cm?.getWrapperElement?.();
      // CodeMirror keeps detached instances cached by frame id.  Wait for
      // React to register the newly mounted, connected instance after a
      // file switch instead of jumping in the stale document.
      if (cm != null && (wrapper == null || wrapper.isConnected)) {
        return;
      }
      await delay(50);
    }
  }

  async gotoSourceLine(
    path: string,
    line: number,
    frameId: string,
  ): Promise<void> {
    const actions = this._actionsForChatPath(path);
    if (actions == null) return;
    this.actions.set_active_id(frameId, true);
    await actions.programmatically_goto_line(line, true, true, frameId);
  }

  // Resolve the most recently focused source pane in this frame tree:
  // the file path it shows (master or an included file), the owning
  // editor actions, and the live CM instance.  Frames showing included
  // files are cm frames with a path override; their CM is registered on
  // the included file's own editor actions.
  private _activeSourceTarget(requested?: {
    path: string;
    cm: CodeMirror.Editor;
  }):
    | { path: string; actions: any; cm: CodeMirror.Editor; frameId?: string }
    | undefined {
    if (requested != null) {
      const actions: any = this._actionsForChatPath(requested.path);
      if (actions == null) return undefined;
      const frameId = Object.entries(
        (actions._cm ?? {}) as Record<string, CodeMirror.Editor>,
      ).find(([, candidate]) => candidate === requested.cm)?.[0];
      return {
        path: requested.path,
        actions,
        cm: requested.cm,
        frameId,
      };
    }
    const frameId = this.actions._get_most_recent_active_frame_id_of_type("cm");
    if (frameId == null) return undefined;
    const node = this.actions._get_frame_node(frameId);
    const path = node?.get("path") ?? this.actions.path;
    const actions: any =
      path === this.actions.path
        ? this.actions
        : this.actions.redux.getEditorActions(this.actions.project_id, path);
    if (actions == null) return undefined;
    let cm: CodeMirror.Editor | undefined = actions._cm?.[frameId];
    let cmFrameId: string | undefined = frameId;
    if (cm == null) {
      cm = actions._get_cm?.(undefined, true);
      cmFrameId = undefined;
    }
    if (cm == null) return undefined;
    return { path, actions, cm, frameId: cmFrameId };
  }

  // Insert a `% chat: <hash>` marker at the cursor of the most recently
  // active source pane (master or included file) and open a fresh
  // side-chat thread for it.
  public insertChatMarker = async (
    opts: {
      mode?: "inline" | "block";
      path?: string;
      cm?: CodeMirror.Editor;
    } = {},
  ): Promise<void> => {
    if (this.actions.is_read_only_preview()) return;
    const hash = generateMarkerHash();
    const target = this._insertMarkerText(
      buildMarkerLine(hash),
      buildInlineInsertion(hash),
      opts.path != null && opts.cm != null
        ? { path: opts.path, cm: opts.cm }
        : undefined,
    );
    if (target == null) {
      return;
    }
    this._chatMarkerScanners[target.path]?.rescan();
    await this.actions.openAnchorChatNewThread(
      hash,
      target.path === this.actions.path ? undefined : target.path,
    );
  };

  // Insert a `% bookmark: <text>` comment at the cursor.  Bookmarks are
  // source-only: they show up in the table of contents but have no
  // chat thread.
  public insertBookmark = async (
    opts: { path?: string; cm?: CodeMirror.Editor } = {},
  ): Promise<void> => {
    if (this.actions.is_read_only_preview()) return;
    const text = generateBookmarkText(new Date());
    const target = this._insertMarkerText(
      buildBookmarkLine(text),
      undefined,
      opts.path != null && opts.cm != null
        ? { path: opts.path, cm: opts.cm }
        : undefined,
    );
    if (target == null) {
      return;
    }
    this._chatMarkerScanners[target.path]?.rescan();
    this.actions.updateTableOfContents(true);
  };

  // Insert a standalone comment line (or an inline tail when the cursor
  // line has tex content and `inline` is provided) at the cursor of the
  // focused source pane.  Returns the pane's file path, or undefined
  // when no editor is available.
  private _insertMarkerText(
    blockLine: string,
    inline?: string,
    requested?: { path: string; cm: CodeMirror.Editor },
  ): { path: string } | undefined {
    const target = this._activeSourceTarget(requested);
    if (target == null) return undefined;
    const { cm, actions, path, frameId } = target;
    const before = cm.getValue();
    const cur = cm.getCursor();
    const lineText = cm.getLine(cur.line) ?? "";
    if (inline != null && lineHasTexContent(lineText)) {
      cm.replaceRange(inline, { line: cur.line, ch: lineText.length });
    } else if (lineText.trim() === "") {
      cm.replaceRange(
        blockLine,
        { line: cur.line, ch: 0 },
        { line: cur.line, ch: lineText.length },
      );
    } else {
      // comment-only (or otherwise occupied) line: add a new line below.
      cm.replaceRange(`\n${blockLine}`, {
        line: cur.line,
        ch: lineText.length,
      });
    }
    // CodeMirror silently cancels edits that touch an atomic/read-only
    // marker. Do not create a config-only chat thread (or report a bookmark
    // insertion) unless the source buffer actually changed.
    if (cm.getValue() === before) {
      return undefined;
    }
    actions.set_syncstring_to_codemirror(frameId);
    actions.syncstring_commit();
    return { path };
  }

  private _commitChatGutterEdit(
    actions: BaseActions<CodeEditorState>,
    cm: CodeMirror.Editor,
  ): void {
    const frameId = Object.entries(
      ((actions as any)._cm ?? {}) as Record<string, CodeMirror.Editor>,
    ).find(([, candidate]) => candidate === cm)?.[0];
    actions.set_syncstring_to_codemirror(frameId);
    actions.syncstring_commit();
  }

  private async _insertChatMarkerBeforeLine(
    path: string,
    line: number,
    cm: CodeMirror.Editor,
  ): Promise<void> {
    const actions = this._actionsForChatPath(path);
    if (actions == null) return;
    const hash = generateMarkerHash();
    cm.replaceRange(`${buildMarkerLine(hash)}\n\n`, { line, ch: 0 });
    this._commitChatGutterEdit(actions, cm);
    this._chatMarkerScanners[path]?.rescan();
    await this.actions.openAnchorChatNewThread(
      hash,
      path === this.actions.path ? undefined : path,
    );
  }

  private _insertBookmarkBeforeLine(
    path: string,
    line: number,
    cm: CodeMirror.Editor,
  ): void {
    const actions = this._actionsForChatPath(path);
    if (actions == null) return;
    const text = generateBookmarkText(new Date());
    const markerLine = buildBookmarkLine(text);
    cm.replaceRange(`${markerLine}\n\n`, { line, ch: 0 });
    this._commitChatGutterEdit(actions, cm);
    this._chatMarkerScanners[path]?.rescan();
    this.actions.updateTableOfContents(true);
    const textStart = markerLine.length - text.length;
    cm.setSelection({ line, ch: textStart }, { line, ch: markerLine.length });
    cm.focus();
  }

  // Resolve every thread anchored to `hash` (collaborative-TODO flow)
  // and remove the marker comment(s) from all scanned files.  The
  // threads remain in the side chat as a read-only record.
  public async resolveChatMarker(
    hash: string,
    expectsThread = true,
  ): Promise<void> {
    const chatActions = await this._waitForReadyChatActions();
    if (chatActions == null) {
      console.warn("resolveChatMarker: side chat did not become ready", {
        project_id: this.actions.project_id,
        path: this.actions.path,
        hash,
      });
      antdMessage.warning(
        "Chat is still loading; the marker was not removed. Please try again.",
      );
      return;
    }
    const label = this.getAnchorLabel(hash);
    let threadKeys: string[] = [];
    if (expectsThread) {
      for (let attempt = 0; attempt < 30; attempt += 1) {
        threadKeys = chatActions.listAnchoredThreadKeys(hash);
        if (threadKeys.length > 0) break;
        await delay(100);
      }
    }
    // Never turn a known discussion into a marker-only deletion just because
    // this client has not received its thread-config row yet.
    if (expectsThread && threadKeys.length === 0) {
      console.warn("resolveChatMarker: anchored thread is still syncing", {
        project_id: this.actions.project_id,
        path: this.actions.path,
        hash,
      });
      antdMessage.warning(
        "Chat is still syncing; the marker was not removed. Please try again.",
      );
      return;
    }
    const chatMarkers = this.actions.store.get("chat_markers");
    if (chatMarkers == null) return;
    const markerPaths = (chatMarkers.keySeq().toJS() as string[]).filter(
      (path) =>
        chatMarkers
          .get(path)
          ?.some(
            (marker: any) => (marker?.get?.("hash") ?? marker?.hash) === hash,
          ) === true,
    );
    if (markerPaths.length === 0) return;
    for (const path of markerPaths) {
      if (!(await this._removeChatMarkersForHash(path, hash))) {
        console.warn("resolveChatMarker: failed to update marker source", {
          project_id: this.actions.project_id,
          path,
          hash,
        });
        antdMessage.warning(
          "The source file could not be updated; the chat was not resolved.",
        );
        return;
      }
    }
    if (!expectsThread) return;

    for (const threadKey of threadKeys) {
      if (!chatActions.resolveAnchoredThread(threadKey, { label })) {
        console.warn("resolveChatMarker: failed to resolve anchored thread", {
          project_id: this.actions.project_id,
          path: this.actions.path,
          hash,
          threadKey,
        });
        antdMessage.warning(
          "The marker was removed, but the chat could not be resolved. Please try again.",
        );
        return;
      }
    }
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const remaining = chatActions.listAnchoredThreadKeys(hash);
      const hasResolved = chatActions
        .listThreadConfigRows()
        .some((row) => parseThreadResolved(row?.resolved)?.anchorId === hash);
      if (remaining.length === 0 && hasResolved) return;
      await delay(100);
    }
    console.warn("resolveChatMarker: resolved state is still syncing", {
      project_id: this.actions.project_id,
      path: this.actions.path,
      hash,
    });
    antdMessage.warning(
      "The marker was removed and the chat is still finishing resolution.",
    );
  }

  private async _waitForReadyChatActions(): Promise<
    ReturnType<typeof ensureSideChatActions> | undefined
  > {
    for (const wait of [0, 25, 50, 100, 250, 500, 1000, 2000]) {
      if (wait > 0) await delay(wait);
      if (this.actions.isClosed()) return;
      try {
        const actions = ensureSideChatActions(
          this.actions.project_id,
          this.actions.path,
        );
        if (actions.syncdb?.get_state?.() === "ready") {
          return actions;
        }
      } catch {
        // Side chat is still mounting; retry within the bounded window.
      }
    }
  }

  // Remove all `% chat: <hash>` markers for one hash from one file.
  private _clearChatTextDecorations(path: string): void {
    const markers = this._chatTextMarkers[path];
    if (markers != null) {
      for (const list of markers.values()) {
        for (const marker of list) marker.clear();
      }
      delete this._chatTextMarkers[path];
    }
    const tails = this._chatTailHosts[path];
    if (tails != null) {
      for (const list of tails.values()) {
        for (const tail of list) {
          tail.bookmark.clear();
          tail.root.unmount();
        }
      }
      delete this._chatTailHosts[path];
    }
  }

  private async _removeChatMarkersForHash(
    path: string,
    hash: string,
  ): Promise<boolean> {
    const actions: any =
      path === this.actions.path
        ? this.actions
        : this.actions.redux.getEditorActions(this.actions.project_id, path);
    const syncstring = actions?._syncstring;
    if (actions != null && syncstring != null) {
      let text: string;
      const isConnected = (candidate: CodeMirror.Editor | undefined) => {
        const wrapper = candidate?.getWrapperElement?.();
        return candidate != null && (wrapper == null || wrapper.isConnected);
      };
      const recentCm: CodeMirror.Editor | undefined = actions._get_cm?.(
        undefined,
        true,
      );
      const liveCm = isConnected(recentCm)
        ? recentCm
        : Object.values(
            (actions._cm ?? {}) as Record<string, CodeMirror.Editor>,
          ).find(isConnected);
      try {
        // CodeMirror can be ahead of the syncstring for a short interval after
        // a local edit. Transform the visible buffer so resolving a marker
        // cannot replace and discard those pending keystrokes.
        text = liveCm?.getValue() ?? syncstring.to_str() ?? "";
      } catch {
        return false;
      }
      const newText = removeMarkersForHash(text, hash);
      if (newText === text) return true;
      // CodeMirror read-only ranges intentionally reject overlapping edits.
      // Remove our transient UI markers before applying the source transform;
      // the scanner recreates any remaining markers immediately afterward.
      this._clearChatTextDecorations(path);
      liveCm?.setValueNoJump(newText);
      actions.set_value(newText);
      actions.syncstring_commit();
      this._chatMarkerScanners[path]?.rescan();
      try {
        const verifiedSyncText = syncstring.to_str() ?? "";
        const verifiedLiveText = liveCm?.getValue() ?? verifiedSyncText;
        return (
          removeMarkersForHash(verifiedSyncText, hash) === verifiedSyncText &&
          removeMarkersForHash(verifiedLiveText, hash) === verifiedLiveText
        );
      } catch {
        return false;
      }
    }

    // Disk-scanned subfiles do not have editor actions or a syncstring. Update
    // them through the project filesystem and verify the marker is gone before
    // allowing the associated thread to become resolved/archived.
    try {
      const fs = this.actions._get_project_actions()?.fs?.();
      if (
        typeof fs?.readFile !== "function" ||
        typeof fs?.writeFileDelta !== "function"
      ) {
        return false;
      }
      const raw = await fs.readFile(path, "utf8");
      const text =
        typeof raw === "string"
          ? raw
          : ((raw as any)?.toString?.("utf8") ?? `${raw ?? ""}`);
      const newText = removeMarkersForHash(text, hash);
      if (newText !== text) {
        await fs.writeFileDelta(path, newText, {
          baseContents: text,
          minLength: 0,
        });
      }
      const verifiedRaw = await fs.readFile(path, "utf8");
      const verifiedText =
        typeof verifiedRaw === "string"
          ? verifiedRaw
          : ((verifiedRaw as any)?.toString?.("utf8") ??
            `${verifiedRaw ?? ""}`);
      if (removeMarkersForHash(verifiedText, hash) !== verifiedText) {
        return false;
      }

      const chatMarkers =
        this.actions.store.get("chat_markers") ?? (fromJS({}) as any);
      const chatBookmarks =
        this.actions.store.get("chat_bookmarks") ?? (fromJS({}) as any);
      (this._diskChatContentHashes ??= new Map()).set(
        path,
        hash_string(verifiedText),
      );
      (this._diskScannedPaths ??= new Set()).add(path);
      (this.diskSubfileHeadings ??= new Map()).set(
        path,
        parseTableOfContents(verifiedText),
      );
      this.actions.setState({
        chat_markers: chatMarkers.set(path, fromJS(scanMarkers(verifiedText))),
        chat_bookmarks: chatBookmarks.set(
          path,
          fromJS(scanBookmarks(verifiedText)),
        ),
      });
      this.actions.updateTableOfContents();
      return true;
    } catch {
      return false;
    }
  }

  private _disposeChatGutterUI(): void {
    for (const cache of [this._chatGutterHosts, this._bookmarkGutterHosts]) {
      for (const perCm of Object.values(cache)) {
        for (const [cm, entries] of perCm) {
          for (const entry of entries) {
            try {
              cm.setGutterMarker(entry.line, CHAT_GUTTER_ID, null);
              entry.root.unmount();
            } catch {
              // The CodeMirror pane may already be gone.
            }
          }
        }
      }
    }
    for (const perCm of Object.values(this._cursorInsertHosts)) {
      for (const [cm, entry] of perCm) {
        try {
          if (entry.currentHandle != null) {
            cm.setGutterMarker(entry.currentHandle, CHAT_GUTTER_ID, null);
          }
          entry.chatRoot.unmount();
          entry.bookmarkRoot.unmount();
        } catch {
          // The CodeMirror pane may already be gone.
        }
      }
    }
    this._chatGutterHosts = {};
    this._bookmarkGutterHosts = {};
    this._cursorInsertHosts = {};
    this._bookmarkLines = {};
    for (const perCm of Object.values(this._chatTextMarkers)) {
      for (const markers of perCm.values()) {
        for (const marker of markers) {
          marker.clear();
        }
      }
    }
    this._chatTextMarkers = {};
    for (const perCm of Object.values(this._chatTailHosts)) {
      for (const tails of perCm.values()) {
        for (const tail of tails) {
          tail.bookmark.clear();
          tail.root.unmount();
        }
      }
    }
    this._chatTailHosts = {};
  }

  // Tear down every scanner, gutter root, text marker and store listener.
  // Called from Actions.close().
  close(): void {
    for (const handle of Object.values(this._chatMarkerScanners)) {
      handle.dispose();
    }
    this._chatMarkerScanners = {};
    this._disposeChatGutterUI();
    this._chatMarkerStoreDispose?.();
    this._chatMarkerStoreDispose = undefined;
    this._chatStoreDispose?.();
    this._chatStoreDispose = undefined;
    this._diskChatScanRefresh?.cancel();
    this._diskChatScanRefresh = undefined;
    this.diskSubfileHeadings.clear();
  }
}
