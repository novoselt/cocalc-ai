/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Map } from "immutable";

import type { JupyterActions } from "@cocalc/frontend/jupyter/browser-actions";
import { MiniTOC } from "./mini-toc";
import {
  CODE_FLEX_DEFAULT,
  COLUMN_TRANSITION,
  OUTPUT_FLEX_DEFAULT,
} from "./styles";
import type { MinimalLayout, SectionBlock } from "./types";

interface StickyMiniTOCProps {
  sectionBlocks: SectionBlock[];
  currentBlockIndex: number;
  cells: Map<string, any>;
  minimalLayout?: MinimalLayout;
  fontSize?: number;
  actions?: JupyterActions;
}

/** Floating mini TOC anchored to the left spacer column */
export function StickyMiniTOC({
  sectionBlocks,
  currentBlockIndex,
  cells,
  minimalLayout,
  fontSize,
  actions,
}: StickyMiniTOCProps) {
  const margin = minimalLayout === "narrow" ? 2 : 0;
  const contentFlex = OUTPUT_FLEX_DEFAULT + CODE_FLEX_DEFAULT;
  const rightSpacerFlex = minimalLayout === "wide" ? 0 : margin;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9,
        pointerEvents: "none",
      }}
    >
      <div style={{ display: "flex" }}>
        {rightSpacerFlex > 0 && (
          <div
            style={{
              flex: `${rightSpacerFlex} 1 0`,
              transition: COLUMN_TRANSITION,
            }}
          />
        )}
        <div
          style={{
            flex: `${CODE_FLEX_DEFAULT} 1 0`,
            transition: COLUMN_TRANSITION,
            pointerEvents: "auto",
            overflow: "hidden",
          }}
        >
          <MiniTOC
            sectionBlocks={sectionBlocks}
            currentBlockIndex={currentBlockIndex}
            cells={cells}
            minimalLayout={minimalLayout}
            fontSize={fontSize}
            actions={actions}
          />
        </div>
        <div style={{ flex: `${contentFlex} 1 0`, minWidth: 0 }} />
        {rightSpacerFlex > 0 && (
          <div
            style={{
              flex: `${rightSpacerFlex} 1 0`,
              transition: COLUMN_TRANSITION,
            }}
          />
        )}
      </div>
    </div>
  );
}
