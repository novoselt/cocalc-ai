/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Math widgets — Phase 4.

Three flavors:
 - MathInline       $…$ and \(…\)
 - MathDisplay      \[…\] and $$…$$ (single-line variants)
 - MathEnv          \begin{equation|align|gather|multline|displaymath|
                    eqnarray}…\end{…} (multi-line, starred variants
                    supported; \label is stripped for the preview)

All three render via `mathToHtml` (KaTeX). A plain click dissolves a
widget to raw source for manual editing. Shift+click opens the cocalc-ai
Agent flyout with the selected formula and bounded nearby source context.

A KaTeX render error doesn't break the widget — we fall back to the
raw LaTeX source, with the KaTeX error available on hover.
*/

import { ReactNode, useContext } from "react";

import mathToHtml from "@cocalc/frontend/misc/math-to-html";

import { MathMacrosContext } from "../math-macros-context";
import { WidgetProps } from "../types";
import { EmptyPlaceholder, Widget } from "./common";
import { prepareMathEnvSource, stripMathLabels } from "./math-source";

function renderMath(
  source: string,
  isInline: boolean,
  macros?: Record<string, string>,
  rawSource?: string,
) {
  if (source.trim() === "") {
    return null;
  }
  const { __html, err } = mathToHtml(source, isInline, macros);
  if (err) {
    // KaTeX couldn't render it (e.g. a macro it doesn't know, or the
    // formula is mid-edit and temporarily broken). Don't show a jarring
    // "?math?" marker — just display the raw LaTeX, so the widget looks
    // like the plain source. The KaTeX error is on hover for debugging.
    return (
      <span title={err} style={{ whiteSpace: "pre-wrap" }}>
        {rawSource ?? source}
      </span>
    );
  }
  return <span dangerouslySetInnerHTML={{ __html }} />;
}

// Display math ($$…$$, \[…\], and the equation/align/… envs) is laid
// out as a centered block. The host span is made `display:block` by the
// widget-manager for these types so the centering spans the line. The
// formula sits in its own horizontally-scrollable box (wide equations
// scroll instead of blowing out the line).
const DISPLAY_WIDGET_STYLE = {
  textAlign: "center",
  width: "100%",
} as const;

const DISPLAY_SCROLL_STYLE = {
  display: "block",
  maxWidth: "100%",
  overflowX: "auto",
} as const;

function DisplayMath({
  props,
  children,
}: {
  props: WidgetProps;
  children: ReactNode;
}) {
  return (
    <Widget {...props} display="block" style={DISPLAY_WIDGET_STYLE}>
      <span style={DISPLAY_SCROLL_STYLE}>{children}</span>
    </Widget>
  );
}

export function MathInline(props: WidgetProps) {
  const macros = useContext(MathMacrosContext);
  const content =
    (props.descriptor.payload?.content as string | undefined) ?? "";
  return (
    <Widget {...props}>
      {content === "" ? (
        <EmptyPlaceholder label="empty math" />
      ) : (
        renderMath(content, true, macros, props.descriptor.source)
      )}
    </Widget>
  );
}

export function MathDisplay(props: WidgetProps) {
  const macros = useContext(MathMacrosContext);
  const content =
    (props.descriptor.payload?.content as string | undefined) ?? "";
  return (
    <DisplayMath props={props}>
      {content === "" ? (
        <EmptyPlaceholder label="empty display math" />
      ) : (
        renderMath(
          stripMathLabels(content),
          false,
          macros,
          props.descriptor.source,
        )
      )}
    </DisplayMath>
  );
}

export function MathEnv(props: WidgetProps) {
  const macros = useContext(MathMacrosContext);
  // For envs, hand the full source (including \begin / \end) to KaTeX —
  // it knows align/gather/equation/multline natively. The source is
  // preprocessed (see math-source.ts): \label stripped, displaymath
  // mapped, and non-starred envs starred so KaTeX doesn't render fake
  // auto-numbered tags; the real numbers come from the PDF build. The
  // CM source itself is untouched and user-explicit \tag{…} keeps
  // working.
  return (
    <DisplayMath props={props}>
      {renderMath(
        prepareMathEnvSource(props.descriptor.source),
        false,
        macros,
        props.descriptor.source,
      )}
    </DisplayMath>
  );
}
