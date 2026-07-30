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
  let out = "";
  let i = 0;
  while (i < source.length) {
    const j = source.indexOf("\\label", i);
    if (j === -1) {
      out += source.slice(i);
      break;
    }
    let k = j + "\\label".length;
    if (/[a-zA-Z]/.test(source[k] ?? "")) {
      // longer control word, e.g. \labelwidth — not a label
      out += source.slice(i, k);
      i = k;
      continue;
    }
    while (k < source.length && /\s/.test(source[k])) {
      k++;
    }
    if (source[k] !== "{") {
      out += source.slice(i, k);
      i = k;
      continue;
    }
    // consume the balanced {…} argument; labels may contain grouped
    // macro args like \label{eq:\arabic{section}}, so a flat regex is
    // not enough. \{ and \} escapes don't affect the depth.
    let depth = 0;
    let m = k;
    while (m < source.length) {
      const c = source[m];
      if (c === "\\") {
        m += 2;
        continue;
      }
      if (c === "{") {
        depth++;
      } else if (c === "}") {
        depth--;
        if (depth === 0) {
          m++;
          break;
        }
      }
      m++;
    }
    if (depth !== 0) {
      // unbalanced (formula is mid-edit) — keep the source as-is
      out += source.slice(i);
      break;
    }
    out += source.slice(i, j);
    i = m;
  }
  return out;
}

export function prepareMathEnvSource(source: string): string {
  return stripMathLabels(source)
    .replace(/\\(begin|end)\{displaymath\}/g, "\\$1{equation*}")
    .replace(/\\(begin|end)\{(equation|align|gather|multline)\}/g, "\\$1{$2*}");
}
