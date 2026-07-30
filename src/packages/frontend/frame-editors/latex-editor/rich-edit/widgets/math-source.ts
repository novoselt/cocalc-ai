/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Prepare raw LaTeX math source for the in-buffer KaTeX preview (the math
widgets and the formula-agent dialog). KaTeX is not a full LaTeX, so a
few constructs that are perfectly fine in real documents would make it
throw — and a throwing preview silently falls back to raw source, which
looks like "the widget parser ignored my formula".

 - `\label{…}` is stripped: KaTeX has no \label at all, so any labelled
   equation/align failed to render. Labels are meaningless in the
   preview anyway (numbering is stripped, see below).
 - `displaymath` becomes `equation*` — KaTeX doesn't know the former;
   they are equivalent unnumbered display math.
 - Non-starred envs become their starred variants so KaTeX doesn't
   render fake auto-numbered tags like `(2)`; the real numbers come
   from the actual LaTeX build in the PDF pane. `eqnarray` needs no
   rewrite here — the KaTeX compat hacks inside mathToHtml map both
   eqnarray and eqnarray* to (unnumbered) darray already.
*/

export function stripMathLabels(source: string): string {
  return source.replace(/\\label\s*\{[^{}]*\}/g, "");
}

export function prepareMathEnvSource(source: string): string {
  return stripMathLabels(source)
    .replace(/\\(begin|end)\{displaymath\}/g, "\\$1{equation*}")
    .replace(/\\(begin|end)\{(equation|align|gather|multline)\}/g, "\\$1{$2*}");
}
