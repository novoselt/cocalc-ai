/*
 *  This file is part of CoCalc: Copyright © 2020 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/* Jupyter cells


- Locked: a locked cell can't have the input/output hidden/shown and can't have the input
  code changed.  However, you *can* run the code and interact with widgets.  This makes
  a notebook with a bunch of locked cells useful for users to share something without consumers
  breaking it.   Also, it matches with jupyter notebook.
*/

import { debounce } from "lodash";
import { useEffect, useRef, useState } from "react";

import useIsMountedRef from "@cocalc/frontend/app-framework/is-mounted-hook";
import { codemirrorMode } from "@cocalc/frontend/file-extensions";
import { useFrameContext } from "../../hooks";
import { Element } from "../../types";
import useEditFocus from "../edit-focus";
import { getMode } from "./actions";
import ControlBar from "./control";
import Input from "./input";
import InputPrompt from "./input-prompt";
import InputStatic from "./input-static";
import Output from "./output";
import getStyle from "./style";

const MIN_HEIGHT = 78;

interface Props {
  element: Element;
  focused?: boolean;
  canvasScale: number;
  cursors?: { [account_id: string]: any[] };
  readOnly?: boolean;
}

export default function Code({
  element,
  focused,
  canvasScale,
  cursors,
  readOnly,
}: Props) {
  const { hideInput, hideOutput } = element.data ?? {};
  const [editFocus, setEditFocus] = useEditFocus(false);
  const { actions, project_id, path } = useFrameContext();
  const [mode, setMode] = useState<any>(codemirrorMode("py"));
  const isMountedRef = useIsMountedRef();
  useEffect(() => {
    let closed = false;
    void (async () => {
      let mode;
      try {
        mode = await getMode({ project_id, path });
      } catch {
        // this can fail, e.g., if user closes file before finishing opening it
        return;
      }
      if (closed || !isMountedRef.current) {
        return;
      }
      setMode(mode);
    })();
    return () => {
      closed = true;
    };
  }, [isMountedRef, path, project_id]);

  const renderInput = () => {
    if (hideInput) return;
    if (!element.locked && focused && !readOnly) {
      return (
        <div className="nodrag">
          <Input
            cursors={cursors}
            isFocused={focused && editFocus}
            element={element}
            focused={focused}
            canvasScale={canvasScale}
            onFocus={() => setEditFocus(true)}
            mode={mode}
            getValueRef={getValueRef}
          />
        </div>
      );
    }
    return <InputStatic element={element} mode={mode} />;
  };
  const outerRef = useRef<HTMLDivElement>(null);
  const divRef = useRef<any>(null);
  const getValueRef = useRef<any>(null);

  // Track element.h in a ref so callbacks always see the latest value.
  const elementHRef = useRef<number>(element.h ?? 0);
  elementHRef.current = element.h ?? 0;

  function getOuterChrome(): { border: number; padding: number } {
    const outer = outerRef.current;
    if (outer == null) return { border: 0, padding: 0 };
    const style = getComputedStyle(outer);
    const toNum = (v: string) => Number.parseFloat(v) || 0;
    return {
      border: toNum(style.borderTopWidth) + toNum(style.borderBottomWidth),
      padding: toNum(style.paddingTop) + toNum(style.paddingBottom),
    };
  }

  // Measure using outerRef.scrollHeight (accurate, blocks margin collapse).
  // When focused, outerRef has height:100% so scrollHeight can't drop
  // below element.h -- measureHeightInner provides a fallback for shrink.
  function measureHeight(): number | undefined {
    const outer = outerRef.current;
    if (outer == null) return;
    const { border } = getOuterChrome();
    return Math.max(MIN_HEIGHT, Math.ceil(outer.scrollHeight + border));
  }

  // Fallback measurement via divRef for detecting shrink in focused mode.
  // May slightly underestimate due to margin collapse, but correctly
  // detects "content got smaller than element.h".
  function measureHeightInner(): number | undefined {
    const inner = divRef.current;
    if (inner == null) return;
    const { border, padding } = getOuterChrome();
    return Math.max(
      MIN_HEIGHT,
      Math.ceil(inner.scrollHeight + padding + border),
    );
  }

  // Single unified height-sync effect for both focused and unfocused modes.
  // Observes both outerRef (for scrollHeight measurement) and divRef (to
  // catch internal content changes that may not resize outerRef when it has
  // a fixed height in focused mode).
  useEffect(() => {
    if (readOnly) return;
    const outer = outerRef.current;
    const inner = divRef.current;
    if (outer == null || inner == null) return;
    if (typeof ResizeObserver === "undefined") return;

    const shrink = debounce(() => {
      // for why "element.str == getValueRef.current?.()" see comment in ../text.tsx
      if (actions.in_undo_mode() && element.str == getValueRef.current?.()) {
        return;
      }
      // Always measure the inner div for shrink: the outer div is floored at
      // element.h (minHeight/height 100% against the fixed-height parent from
      // position.tsx), so outer.scrollHeight can never report a smaller box.
      const h = measureHeightInner();
      if (h != null && Math.abs(h - elementHRef.current) > 2) {
        actions.setElement({ obj: { id: element.id, h }, commit: !focused });
      }
    }, 250);

    const sync = () => {
      if (actions.in_undo_mode() && element.str == getValueRef?.current?.()) {
        return;
      }
      const h = measureHeight();
      if (h == null) return;
      if (h > elementHRef.current + 2) {
        // Grow immediately so bounding box matches content.
        // Commit when unfocused so collaborators see the change.
        // The 2px threshold mirrors the shrink side: without it a constant
        // sub-pixel overshoot in the measurement feeds back through the
        // ResizeObserver and the cell grows without bound.
        shrink.cancel();
        actions.setElement({ obj: { id: element.id, h }, commit: !focused });
      } else if (!focused) {
        // Shrink with a delay to avoid oscillation, and only when unfocused --
        // shrinking a focused cell fights the editor and oscillates.
        // Measured on the inner div for the reason given in shrink() above.
        const inner = measureHeightInner();
        if (inner != null && inner < elementHRef.current - 2) {
          shrink();
        }
      }
    };

    const observer = new ResizeObserver(sync);
    observer.observe(outer);
    observer.observe(inner);

    // Immediate measurement.
    sync();
    // Deferred: catch children that lay out after the first frame
    // (e.g. CodeMirror editor, output rendering).
    const raf = requestAnimationFrame(sync);

    return () => {
      observer.disconnect();
      shrink.cancel();
      cancelAnimationFrame(raf);
    };
  }, [focused, element.id, canvasScale, editFocus, readOnly]);

  return (
    <div
      ref={outerRef}
      style={{
        ...getStyle(element),
        ...(focused
          ? { height: "100%", overflowY: "hidden" }
          : { minHeight: "100%", height: "auto", overflowY: "visible" }),
      }}
    >
      {/* flow-root establishes a block formatting context so the InputPrompt's
          margin-top is contained rather than collapsing out of this div; that
          is what makes divRef.scrollHeight an accurate content measurement. */}
      <div ref={divRef} style={{ display: "flow-root" }}>
        {!hideInput && <InputPrompt element={element} />}
        {renderInput()}
        {!hideOutput && element.data?.output && (
          <Output element={element} onClick={() => setEditFocus(true)} />
        )}
        {focused && !readOnly && <ControlBar element={element} />}
      </div>
    </div>
  );
}
