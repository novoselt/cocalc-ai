/*
 *  This file is part of CoCalc: Copyright © 2020-2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { List, Map, Set as ImmutableSet } from "immutable";
import React, {
  MutableRefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { hash_string } from "@cocalc/util/misc";
import { COLORS } from "@cocalc/util/theme";

const MINIMAP_WIDTH = 40;
const VIEWPORT_MIN_HEIGHT = 12;
const CELL_GAP = 2; // visible gap between cells
const MIN_CELL_HEIGHT = 2;

const CURRENT_COLOR = "#42a5f5"; // blue — matches gutter

export type CellStatus =
  | "running"
  | "queued"
  | "error"
  | "stale"
  | "idle"
  | "dirty"
  | "markdown";

export function getCellStatus(
  cell: Map<string, any>,
  lastExecInputHash: { [id: string]: number },
): CellStatus {
  const cellType = cell.get("cell_type") || "code";
  if (cellType !== "code") return "markdown";
  const state = cell.get("state");
  if (state === "busy") return "running";
  if (state === "run" || state === "start") return "queued";
  const output = cell.get("output");
  if (output) {
    for (const [, msg] of output) {
      if (msg?.get?.("traceback")) return "error";
    }
  }
  // Cell has been executed — check if input changed since last run
  const id = cell.get("id");
  const snapshotHash = lastExecInputHash[id];
  // Unexecuted or modified cells are "dirty" (darker gray)
  if (!cell.get("exec_count") && !output) return "dirty";
  if (
    snapshotHash !== undefined &&
    snapshotHash !== hash_string(cell.get("input") ?? "")
  ) {
    return "dirty";
  }
  return "idle";
}

const STATUS_COLORS: Record<CellStatus, string> = {
  running: "#5cb85c",
  queued: "#2e7d32",
  error: COLORS.ANTD_RED,
  stale: COLORS.GRAY_L, // kept for type completeness
  dirty: COLORS.GRAY_L, // edited since last run / unexecuted — darker
  idle: COLORS.GRAY_L0, // clean (executed, unchanged) — lighter, same as markdown
  markdown: COLORS.GRAY_L0,
};

// Estimate for cells that were never rendered/measured: the lazy-render
// placeholder box is min-height 96 plus padding and margin.
const DEFAULT_CELL_HEIGHT = 120;

export interface MinimalMinimapEntry {
  id: string;
  pixelHeight: number;
  status: CellStatus;
  isCode: boolean;
  isCurrent: boolean;
  isSelected: boolean;
}

// Priority for surfacing hidden-cell activity on a collapsed-section entry;
// anything not listed never overrides the section's default "markdown".
const COLLAPSED_STATUS_RANK: Partial<Record<CellStatus, number>> = {
  error: 1,
  queued: 2,
  running: 3,
};

export function buildMinimalMinimapEntries({
  cellList,
  cells,
  collapsedSections,
  heightCache,
  lastExecInputHash,
  curId,
  selIds,
}: {
  cellList: List<string>;
  cells: Map<string, any>;
  collapsedSections: Set<string>;
  heightCache: Record<string, number>;
  lastExecInputHash: Record<string, number>;
  curId?: string;
  selIds?: ImmutableSet<string>;
}): MinimalMinimapEntry[] {
  const entries: MinimalMinimapEntry[] = [];
  let inCollapsed = false;
  let collapsedLevel = 0;
  let collapsedEntryIdx: number | null = null;

  cellList.forEach((id: string) => {
    const cell = cells.get(id);
    if (!cell) return;

    const cellType = cell.get("cell_type") || "code";
    let headingLevel = 0;
    if (cellType === "markdown") {
      const input = (cell.get("input") || "").trimStart();
      const match = input.match(/^(#{1,4})\s/);
      if (match) headingLevel = match[1].length;
    }

    if (headingLevel > 0) {
      if (collapsedSections.has(id)) {
        inCollapsed = true;
        collapsedLevel = headingLevel;
        collapsedEntryIdx = entries.length;
        entries.push({
          id,
          pixelHeight: 24,
          status: "markdown",
          isCode: false,
          isCurrent: id === curId,
          isSelected: selIds?.has(id) ?? false,
        });
        return;
      } else if (inCollapsed && headingLevel <= collapsedLevel) {
        inCollapsed = false;
        collapsedEntryIdx = null;
      }
    }

    if (inCollapsed) {
      // Surface running/queued/error activity of hidden cells on the
      // collapsed section's single minimap entry, so a folded section still
      // shows execution feedback.
      if (collapsedEntryIdx != null && cellType === "code") {
        const status = getCellStatus(cell, lastExecInputHash);
        const rank = COLLAPSED_STATUS_RANK[status] ?? 0;
        const current =
          COLLAPSED_STATUS_RANK[entries[collapsedEntryIdx].status] ?? 0;
        if (rank > current) {
          entries[collapsedEntryIdx].status = status;
        }
      }
      return;
    }

    entries.push({
      id,
      pixelHeight: heightCache[id] ?? DEFAULT_CELL_HEIGHT,
      status: getCellStatus(cell, lastExecInputHash),
      isCode: cellType === "code",
      isCurrent: id === curId,
      isSelected: selIds?.has(id) ?? false,
    });
  });

  return entries;
}

export interface MinimapBarSegment {
  entry: MinimalMinimapEntry;
  top: number;
  height: number;
}

/**
 * Lay the entries out over exactly `height` pixels: proportional to their
 * document pixel heights, with a small gap and a minimum bar height.  The
 * clamps would make the stack overflow the minimap for notebooks with many
 * cells (and undershoot for few), so the result is renormalized to always
 * span the full height — otherwise bar positions drift against the viewport
 * rectangle.
 */
export function computeMinimapLayout(
  entries: MinimalMinimapEntry[],
  height: number,
): MinimapBarSegment[] {
  if (entries.length === 0 || height <= 0) return [];
  const totalPixels = entries.reduce((s, e) => s + e.pixelHeight, 0) || 1;
  const scale = height / totalPixels;
  const raw = entries.map((e) =>
    Math.max(MIN_CELL_HEIGHT, e.pixelHeight * scale - CELL_GAP),
  );
  const rawTotal = raw.reduce((s, h) => s + h + CELL_GAP, 0);
  const factor = height / rawTotal;
  const segments: MinimapBarSegment[] = [];
  let y = 0;
  entries.forEach((entry, i) => {
    // no extra floor here: raw is already clamped, and flooring again after
    // scaling would break the normalization for notebooks with many cells
    const h = raw[i] * factor;
    segments.push({ entry, top: y, height: h });
    y += h + CELL_GAP * factor;
  });
  return segments;
}

/** First/last cell visible in the scroller, with the fraction of each. */
export interface MinimapVisibleRange {
  firstId: string;
  firstFrac: number; // fraction of the first cell hidden above the top edge
  lastId: string;
  lastFrac: number; // fraction of the last cell above the bottom edge
}

/**
 * Map the visible cell range into minimap bar coordinates.  Computing the
 * viewport from the actually visible cells (instead of scrollTop ratios)
 * keeps the rectangle aligned with the bars even when per-cell height
 * estimates are off.
 */
export function viewportFromSegments(
  segments: MinimapBarSegment[],
  range: MinimapVisibleRange | null,
): { top: number; bottom: number } | null {
  if (range == null) return null;
  let first: MinimapBarSegment | undefined;
  let last: MinimapBarSegment | undefined;
  for (const seg of segments) {
    if (seg.entry.id === range.firstId) first = seg;
    if (seg.entry.id === range.lastId) last = seg;
  }
  if (first == null || last == null) return null;
  const top = first.top + range.firstFrac * first.height;
  const bottom = last.top + range.lastFrac * last.height;
  if (bottom <= top) return null;
  return { top, bottom };
}

interface MinimalMinimapProps {
  cellList: List<string>;
  cells: Map<string, any>;
  collapsedSections: Set<string>;
  scrollerRef: MutableRefObject<HTMLElement | null>;
  cellHeights: MutableRefObject<{ [index: number]: number }>;
  height: number;
  curId?: string;
  selIds?: ImmutableSet<string>;
}

export const MinimalMinimap: React.FC<MinimalMinimapProps> = React.memo(
  ({
    cellList,
    cells,
    collapsedSections,
    scrollerRef,
    cellHeights,
    height,
    curId,
    selIds,
  }) => {
    const [scrollRatio, setScrollRatio] = useState(0);
    const [viewportRatio, setViewportRatio] = useState(1);
    const [visibleRange, setVisibleRange] =
      useState<MinimapVisibleRange | null>(null);
    const minimapRef = useRef<HTMLDivElement>(null);
    const segmentsRef = useRef<MinimapBarSegment[]>([]);
    const draggingRef = useRef(false);
    const [dragging, setDragging] = useState(false);
    // Persistent height cache: cellId → last known pixel height
    const heightCacheRef = useRef<{ [id: string]: number }>({});
    // Track cells that were evaluating in the previous render
    const prevEvaluatingRef = useRef<Set<string>>(new Set());
    // Hash of cell input at time of last execution (for dirty detection)
    const lastExecInputHashRef = useRef<{ [id: string]: number }>({});
    const prevExecCountRef = useRef<{ [id: string]: number }>({});

    useEffect(() => {
      const el = scrollerRef.current;
      if (!el) return;
      const update = () => {
        const maxScroll = el.scrollHeight - el.clientHeight;
        if (maxScroll <= 0) {
          setScrollRatio(0);
          setViewportRatio(1);
        } else {
          setScrollRatio(el.scrollTop / maxScroll);
          setViewportRatio(Math.min(1, el.clientHeight / el.scrollHeight));
        }
        // Determine the first/last visible cell (plus fraction) so the
        // viewport rectangle can be drawn in bar coordinates.  Cells are
        // wrapped in [data-jupyter-lazy-cell-id] whether hydrated or not.
        const elRect = el.getBoundingClientRect();
        let first: { id: string; frac: number } | null = null;
        let last: { id: string; frac: number } | null = null;
        for (const node of el.querySelectorAll<HTMLElement>(
          "[data-jupyter-lazy-cell-id]",
        )) {
          const r = node.getBoundingClientRect();
          if (r.height <= 0 || r.bottom <= elRect.top) continue;
          if (r.top >= elRect.bottom) break;
          const id = node.getAttribute("data-jupyter-lazy-cell-id");
          if (id == null) continue;
          if (first == null) {
            first = {
              id,
              frac: Math.max(0, Math.min(1, (elRect.top - r.top) / r.height)),
            };
          }
          last = {
            id,
            frac: Math.max(0, Math.min(1, (elRect.bottom - r.top) / r.height)),
          };
        }
        setVisibleRange(
          first != null && last != null
            ? {
                firstId: first.id,
                firstFrac: first.frac,
                lastId: last.id,
                lastFrac: last.frac,
              }
            : null,
        );
      };
      update();
      el.addEventListener("scroll", update, { passive: true });
      const observer = new ResizeObserver(update);
      observer.observe(el);
      return () => {
        el.removeEventListener("scroll", update);
        observer.disconnect();
      };
    }, [scrollerRef.current, cellList, collapsedSections]);

    // Scroll — hooks must be called unconditionally (before any early return)
    const scrollTo = useCallback(
      (clientY: number) => {
        const el = scrollerRef.current;
        const map = minimapRef.current;
        if (!el || !map) return;
        const rect = map.getBoundingClientRect();
        const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
        // Map the clicked bar position to a cell + fraction and center the
        // scroller on the corresponding document position — the inverse of
        // how the viewport rectangle is drawn, so clicking inside the
        // rectangle doesn't jump.
        const segments = segmentsRef.current;
        const seg =
          segments.find((s) => y <= s.top + s.height) ??
          segments[segments.length - 1];
        if (seg != null) {
          const frac =
            seg.height > 0
              ? Math.max(0, Math.min(1, (y - seg.top) / seg.height))
              : 0;
          const node = el.querySelector<HTMLElement>(
            `[data-jupyter-lazy-cell-id="${seg.entry.id}"]`,
          );
          if (node != null) {
            const nodeRect = node.getBoundingClientRect();
            const elRect = el.getBoundingClientRect();
            const cellTop = nodeRect.top - elRect.top + el.scrollTop;
            el.scrollTop =
              cellTop + frac * nodeRect.height - el.clientHeight / 2;
            return;
          }
        }
        // Fallback: linear ratio mapping.
        const ratio = rect.height > 0 ? y / rect.height : 0;
        const vpHalf = viewportRatio / 2;
        const targetRatio = Math.max(
          0,
          Math.min(1, (ratio - vpHalf) / Math.max(0.001, 1 - viewportRatio)),
        );
        el.scrollTop = targetRatio * (el.scrollHeight - el.clientHeight);
      },
      [viewportRatio],
    );

    const handlePointerDown = useCallback(
      (e: React.PointerEvent) => {
        e.preventDefault();
        e.stopPropagation();
        draggingRef.current = true;
        setDragging(true);
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        scrollTo(e.clientY);
      },
      [scrollTo],
    );
    const handlePointerMove = useCallback(
      (e: React.PointerEvent) => {
        if (draggingRef.current) scrollTo(e.clientY);
      },
      [scrollTo],
    );
    const handlePointerUp = useCallback(() => {
      draggingRef.current = false;
      setDragging(false);
    }, []);

    const minimapHeight = height - 16;
    if (minimapHeight <= 0) return null;

    // Update persistent height cache from Virtuoso measurements.
    // Skip cells that are running/queued or just finished evaluating —
    // Virtuoso may still have a stale mid-evaluation measurement.
    const cache = heightCacheRef.current;
    const prevEval = prevEvaluatingRef.current;
    const currentlyEvaluating = new Set<string>();
    cellList.forEach((id: string, index: number) => {
      const cell = cells.get(id);
      const state = cell?.get("state");
      const isEvaluating =
        state === "busy" || state === "run" || state === "start";
      if (isEvaluating) {
        currentlyEvaluating.add(id);
      }
      const measured = cellHeights.current[index];
      if (measured != null && measured > 0) {
        // Don't update if cell is evaluating, or just finished (stale measurement)
        const justFinished = prevEval.has(id) && !isEvaluating;
        if (!isEvaluating && !justFinished) {
          cache[id] = measured;
        } else if (!cache[id]) {
          // No cached value at all — use whatever we have
          cache[id] = measured;
        }
      }
    });
    prevEvaluatingRef.current = currentlyEvaluating;

    // Track exec_count changes to snapshot input hash at execution time
    const lastExecInputHash = lastExecInputHashRef.current;
    const prevExecCounts = prevExecCountRef.current;
    cellList.forEach((id: string) => {
      const cell = cells.get(id);
      if (!cell) return;
      const execCount = cell.get("exec_count");
      if (execCount != null && execCount !== prevExecCounts[id]) {
        // Cell was just executed — snapshot the input hash
        lastExecInputHash[id] = hash_string(cell.get("input") ?? "");
        prevExecCounts[id] = execCount;
      }
    });

    // Build visible cell entries, respecting collapsed sections
    const entries = buildMinimalMinimapEntries({
      cellList,
      cells,
      collapsedSections,
      heightCache: cache,
      lastExecInputHash,
      curId,
      selIds,
    });

    const segments = computeMinimapLayout(entries, minimapHeight);
    segmentsRef.current = segments;

    // Viewport rectangle: anchored to the visible cell range when known,
    // otherwise fall back to plain scroll ratios.
    const rangeVp = viewportFromSegments(segments, visibleRange);
    let vpTop: number;
    let vpHeight: number;
    if (rangeVp != null) {
      vpTop = rangeVp.top;
      vpHeight = rangeVp.bottom - rangeVp.top;
    } else {
      vpTop = scrollRatio * (1 - viewportRatio) * minimapHeight;
      vpHeight = viewportRatio * minimapHeight;
    }
    if (vpHeight < VIEWPORT_MIN_HEIGHT) {
      vpTop -= (VIEWPORT_MIN_HEIGHT - vpHeight) / 2;
      vpHeight = VIEWPORT_MIN_HEIGHT;
    }
    vpTop = Math.max(0, Math.min(minimapHeight - vpHeight, vpTop));

    return (
      <div
        ref={minimapRef}
        style={{
          position: "relative",
          width: MINIMAP_WIDTH,
          minWidth: MINIMAP_WIDTH,
          height: minimapHeight,
          marginTop: 8,
          cursor: dragging ? "grabbing" : "grab",
          userSelect: "none",
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onWheel={(e) => {
          // Forward scroll wheel to the notebook scroller
          const el = scrollerRef.current;
          if (el) el.scrollTop += e.deltaY;
        }}
      >
        {/* Cell bars */}
        {segments.map(({ entry, top, height: h }) => {
          const { id, status, isCode, isCurrent, isSelected } = entry;
          const color = STATUS_COLORS[status];
          const isEval = status === "running" || status === "queued";

          // Running/queued takes precedence over selection highlight
          // so users can see execution progress sweep through
          if (!isEval && (isCurrent || isSelected)) {
            return (
              <div
                key={id}
                style={{
                  position: "absolute",
                  top,
                  left: 4,
                  right: 4,
                  height: h,
                  backgroundColor: CURRENT_COLOR,
                  opacity: isCurrent ? 0.8 : 0.5,
                  borderRadius: "1px",
                }}
              />
            );
          }

          // Markdown cells: narrower, fainter bars
          // Code cells: wider bars with status color
          // Running cell blinks
          return (
            <div
              key={id}
              className={
                status === "running" ? "minimap-cell-running" : undefined
              }
              style={{
                position: "absolute",
                top,
                left: 4,
                right: 4,
                height: h,
                backgroundColor: color,
                opacity: isCode ? 0.8 : 0.5,
                borderRadius: "1px",
              }}
            />
          );
        })}

        {/* Viewport rectangle */}
        <div
          style={{
            position: "absolute",
            top: vpTop,
            left: 0,
            right: 0,
            height: vpHeight,
            border: `1.5px solid ${COLORS.GRAY_M}`,
            borderRadius: "2px",
            backgroundColor: "rgba(0,0,0,0.04)",
            pointerEvents: "none",
          }}
        />
      </div>
    );
  },
);
