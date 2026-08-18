/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Map } from "immutable";

import { useAnimatedTransition } from "@cocalc/frontend/app/animations";
import type { JupyterActions } from "@cocalc/frontend/jupyter/browser-actions";
import { MiniTOC } from "./mini-toc";
import {
  CODE_FLEX_DEFAULT,
  COLUMN_TRANSITION,
  OUTPUT_FLEX_DEFAULT,
} from "./styles";
import type { StudioLayout, SectionBlock } from "./types";

interface StickyMiniTOCProps {
  sectionBlocks: SectionBlock[];
  currentBlockIndex: number;
  cells: Map<string, any>;
  studioLayout?: StudioLayout;
  fontSize?: number;
  actions?: JupyterActions;
}

/** Floating mini TOC anchored to the left spacer column */
export function StickyMiniTOC({
  sectionBlocks,
  currentBlockIndex,
  cells,
  studioLayout,
  fontSize,
  actions,
}: StickyMiniTOCProps) {
  const columnTransition = useAnimatedTransition(COLUMN_TRANSITION);
  const margin = studioLayout === "narrow" ? 2 : 0;
  const contentFlex = OUTPUT_FLEX_DEFAULT + CODE_FLEX_DEFAULT;
  const rightSpacerFlex = studioLayout === "wide" ? 0 : margin;

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
              transition: columnTransition,
            }}
          />
        )}
        <div
          style={{
            flex: `${CODE_FLEX_DEFAULT} 1 0`,
            transition: columnTransition,
            pointerEvents: "auto",
            overflow: "hidden",
          }}
        >
          <MiniTOC
            sectionBlocks={sectionBlocks}
            currentBlockIndex={currentBlockIndex}
            cells={cells}
            studioLayout={studioLayout}
            fontSize={fontSize}
            actions={actions}
          />
        </div>
        <div style={{ flex: `${contentFlex} 1 0`, minWidth: 0 }} />
        {rightSpacerFlex > 0 && (
          <div
            style={{
              flex: `${rightSpacerFlex} 1 0`,
              transition: columnTransition,
            }}
          />
        )}
      </div>
    </div>
  );
}
