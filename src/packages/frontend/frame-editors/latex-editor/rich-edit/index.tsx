/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
LatexCodemirrorEditor — wraps the standard CodemirrorEditor with a top
toolbar (`RichEditToolbar`) hosting the LaTeX / Rich Text mode control
and format-action buttons. The underlying CodemirrorEditor is
unchanged. Wired in via `latex-editor/editor.ts` as the `cm` frame's
component.

When the user is in Rich Text mode, this wrapper attaches
the widget manager to the live CM instance. The manager parses the
visible viewport, mints `cm.markText({replacedWith})` markers for
recognized LaTeX constructs, and reconciles across rescans via
`marker.find()` so scrolling and unrelated edits don't churn DOM.

Stability note
--------------
`useFrameContext()` returns a fresh object identity on every parent
render (frame-tree.tsx constructs the context value as an object
literal). If we put `frameContext` or `editor_actions` in the
useEffect deps, the manager would dispose and re-attach on every
parent render — wiping the reconciler's live-marker registry. That
flicker was the exact failure mode validated and fixed during the
Phase 2.0 spike. We capture both through refs and depend only on the
stable identifiers `richEditMode` + `props.id` + `props.path`.

See `src/docs/latex-rich-edit-design.md` for the full design.
*/

import { useEffect, useRef } from "react";

import { useFrameContext } from "@cocalc/frontend/frame-editors/frame-tree/frame-context";

import { CodemirrorEditor } from "../../code-editor/codemirror-editor";
import { EditorComponentProps } from "../../frame-tree/types";
import { useLatexEditMode } from "./mode";
import { RichEditToolbar } from "./toolbar";
import { attachWidgetManager } from "./widget-manager";

const WRAPPER_STYLE = {
  display: "flex",
  flexDirection: "column",
  width: "100%",
  height: "100%",
  minHeight: 0,
} as const;

const CM_CONTAINER_STYLE = {
  flex: 1,
  minHeight: 0,
  display: "flex",
  flexDirection: "column",
} as const;

export function LatexCodemirrorEditor(props: EditorComponentProps) {
  const frameContext = useFrameContext();

  // Refs to hold the latest unstable references. Updated on every
  // render but never trigger the widget-manager-attach effect.
  const frameContextRef = useRef(frameContext);
  const editorActionsRef = useRef(props.editor_actions);
  frameContextRef.current = frameContext;
  editorActionsRef.current = props.editor_actions;

  // This device-wide preference is shared by every open LaTeX document.
  // Raw LaTeX is the default when no preference has been saved.
  const editMode = useLatexEditMode();
  const richEditMode = editMode === "rich";

  // Attach the widget manager when "Rich Text" is selected.
  useEffect(() => {
    if (!richEditMode) return;
    let dispose: (() => void) | null = null;
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const tryAttach = () => {
      if (cancelled) return;
      // CodemirrorEditor stores the live cm instance on
      // editor_actions._cm[id] after init (see
      // code-editor/actions.ts ~1598). We poll briefly because CM
      // init runs in a useEffect on CodemirrorEditor and may not be
      // ready on the first render of this wrapper.
      //
      // IMPORTANT: look up _cm[props.id] DIRECTLY — do not fall back
      // to _get_cm(props.id). That helper returns the active/most-
      // recent CM when the requested id isn't registered yet, which
      // when two LaTeX source frames are open would attach this
      // wrapper's manager to a DIFFERENT pane's CM (duplicate
      // markers there, none here, and unmounting either pane could
      // dispose widgets on the wrong one).
      const cm = editorActionsRef.current?._cm?.[props.id];
      if (cm) {
        // FrameContext identifies the owning LaTeX editor, whose path can be
        // the master document even when this leaf displays an included file.
        dispose = attachWidgetManager(cm, {
          ...frameContextRef.current,
          path: props.path,
        });
      } else {
        retryTimer = setTimeout(tryAttach, 100);
      }
    };
    tryAttach();
    return () => {
      cancelled = true;
      if (retryTimer != null) clearTimeout(retryTimer);
      dispose?.();
    };
    // Deliberately exclude frameContext + editor_actions: captured
    // via refs above; including them would re-fire this effect on
    // every parent render and wipe the marker manager's live
    // registry (validated in the Phase 2.0 spike).
    //
    // `props.path` IS a dep: when a source pane is switched to an
    // included file (`switch_to_file`) the leaf id stays the same but a
    // different CM mounts under the (now child) editor_actions. Without
    // re-running, the manager would stay attached to the previous CM and
    // the newly shown file would get no widgets until a mode toggle.
    // `props.path` is a stable string, so this doesn't re-fire on
    // ordinary re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [richEditMode, props.id, props.path]);

  return (
    <div style={WRAPPER_STYLE} className="cc-latex-rich-edit-frame">
      <RichEditToolbar
        id={props.id}
        editor_actions={props.editor_actions}
        editMode={editMode}
      />
      <div style={CM_CONTAINER_STYLE}>
        <CodemirrorEditor {...(props as any)} />
      </div>
    </div>
  );
}
