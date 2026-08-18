/*
 *  This file is part of CoCalc: Copyright © 2020-2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { List, Map } from "immutable";
import type { SectionBlock } from "./types";

/**
 * Detect the heading level from a markdown cell's input.
 * Returns 1-4 for h1-h4, or 0 if no heading is found.
 */
function getHeadingLevel(input: string): number {
  const match = input.trimStart().match(/^(#{1,4})\s/);
  if (match) {
    return match[1].length;
  }
  return 0;
}

/**
 * Given a cell list and cells map, compute section blocks.
 *
 * A section block is a group of cells between two heading-markdown cells.
 * Cells before the first heading form an implicit block (headingLevel=0).
 */
export function computeSectionBlocks(
  cellList: List<string>,
  cells: Map<string, any>,
): SectionBlock[] {
  const blocks: SectionBlock[] = [];
  let currentBlock: SectionBlock | null = null;

  cellList.forEach((id: string) => {
    const cell = cells.get(id);
    if (cell == null) return;

    const cellType = cell.get("cell_type") || "code";
    let headingLevel = 0;

    if (cellType === "markdown") {
      const input = cell.get("input") || "";
      headingLevel = getHeadingLevel(input);
    }

    if (headingLevel > 0) {
      if (currentBlock != null) {
        blocks.push(currentBlock);
      }
      currentBlock = {
        startCellId: id,
        cellIds: [id],
        headingLevel,
      };
    } else {
      if (currentBlock == null) {
        currentBlock = {
          startCellId: id,
          cellIds: [id],
          headingLevel: 0,
        };
      } else {
        currentBlock.cellIds.push(id);
      }
    }
  });

  if (currentBlock != null) {
    blocks.push(currentBlock);
  }

  return blocks;
}

/**
 * Structural equality for section blocks. Editing or executing a cell changes
 * the top-level cells map, which recomputes the blocks — but usually the
 * section *structure* is unchanged. Callers use this to keep the previous
 * blocks array (and hence all derived per-cell props like blockInfo and
 * blockCellIds) referentially stable, so memoized cells don't all rerender.
 */
export function sectionBlocksEqual(
  a: SectionBlock[],
  b: SectionBlock[],
): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i];
    const y = b[i];
    if (
      x.startCellId !== y.startCellId ||
      x.headingLevel !== y.headingLevel ||
      x.cellIds.length !== y.cellIds.length
    ) {
      return false;
    }
    for (let j = 0; j < x.cellIds.length; j++) {
      if (x.cellIds[j] !== y.cellIds[j]) return false;
    }
  }
  return true;
}

/**
 * Aggregate execution state of the code cells in a (collapsed) section:
 * "running" if any cell is executing or queued, otherwise "error" if any
 * cell's output contains a traceback, else null.  Used to surface activity
 * of folded sections on the section header and the minimap.
 */
export function computeSectionRunState(
  cellIds: string[],
  cells: Map<string, any>,
): "running" | "error" | null {
  let error = false;
  for (const id of cellIds) {
    const cell = cells.get(id);
    if (cell == null) continue;
    if ((cell.get("cell_type") || "code") !== "code") continue;
    const state = cell.get("state");
    if (state === "busy" || state === "run" || state === "start") {
      return "running";
    }
    if (!error) {
      const output = cell.get("output");
      if (output != null) {
        for (const [, msg] of output) {
          if (msg?.get?.("traceback")) {
            error = true;
            break;
          }
        }
      }
    }
  }
  return error ? "error" : null;
}

export interface BlockInfo {
  blockIndex: number;
  positionInBlock: number;
  blockSize: number;
}

/**
 * Build a lookup: cell ID → block info.
 * Used by the gutter to know which block a cell belongs to
 * and whether it's the first/last in its block.
 */
export function buildBlockLookup(
  blocks: SectionBlock[],
): globalThis.Map<string, BlockInfo> {
  const lookup = new globalThis.Map<string, BlockInfo>();
  blocks.forEach((block, blockIndex) => {
    block.cellIds.forEach((cellId, positionInBlock) => {
      lookup.set(cellId, {
        blockIndex,
        positionInBlock,
        blockSize: block.cellIds.length,
      });
    });
  });
  return lookup;
}
