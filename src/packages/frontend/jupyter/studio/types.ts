/*
 *  This file is part of CoCalc: Copyright © 2020-2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export type CellViewMode = "default" | "studio";

/** Width/layout modes of the studio notebook view */
export type StudioLayout = "wide" | "comfortable" | "narrow";

export interface SectionBlock {
  /** Cell ID that starts this block (the heading markdown cell, or first cell for the implicit block) */
  startCellId: string;
  /** All cell IDs in this block, in order */
  cellIds: string[];
  /** Heading level (1-4) or 0 for the implicit first block */
  headingLevel: number;
}
