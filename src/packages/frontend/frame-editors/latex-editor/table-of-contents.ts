/*
A quick naive table of contents implementation, at least for the master document.

This isn't sophisticated at all.  We also don't include the numbers even though we compute
them, since it's too easy to mess them up by including subfiles or using macros to
change them.
*/

import { TableOfContentsEntry as Entry } from "@cocalc/frontend/components";

import { scanBookmarks, scanMarkers } from "./chat-markers";

export interface ChatTocExtra {
  kind: "chat";
  hash: string;
}

export interface ParseTableOfContentsOptions {
  // Overlay `% chat: <hash>` markers as entries (deduped by hash,
  // first occurrence wins).
  includeChatMarkers?: boolean;
  // Overlay `% bookmark: <text>` comments as entries (deduped by text).
  includeBookmarks?: boolean;
}

export function parseTableOfContents(
  latex: string,
  opts: ParseTableOfContentsOptions = {},
): Entry[] {
  const entries = parseHeadings(latex);
  const overlay: Entry[] = [];
  if (opts.includeChatMarkers) {
    const seen = new Set<string>();
    for (const m of scanMarkers(latex)) {
      if (seen.has(m.hash)) continue;
      seen.add(m.hash);
      overlay.push({
        // ids must be unique across the TOC; scrollToHeading parseInt()s
        // them, so a "<line>-..." suffix still jumps to the right line.
        id: `${m.line + 1}-chat-${m.hash}`,
        value: `Chat ${m.hash} (line ${m.line + 1})`,
        icon: "comment",
        extra: { kind: "chat", hash: m.hash } as ChatTocExtra,
      });
    }
  }
  if (opts.includeBookmarks) {
    const seen = new Set<string>();
    for (const b of scanBookmarks(latex)) {
      if (seen.has(b.text)) continue;
      seen.add(b.text);
      overlay.push({
        id: `${b.line + 1}-bookmark-${b.text}`,
        value: b.text,
        icon: "tag-outlined",
      });
    }
  }
  if (overlay.length === 0) {
    return entries;
  }
  // Interleave overlay entries into the heading list in document order.
  const merged = [...entries, ...overlay];
  merged.sort((a, b) => parseInt(a.id) - parseInt(b.id));
  return merged;
}

function parseHeadings(latex: string): Entry[] {
  let id = 0;
  const entries: Entry[] = [];
  let number: number[] = [0];
  for (const line0 of latex.split("\n")) {
    id += 1;
    const line = line0.trim();
    if (line.startsWith("\\section{")) {
      number = [number[0] + 1];
      entries.push({
        level: 1,
        value: line.slice("\\section{".length, -1),
        id: `${id}`,
        /*number, */
      });
      continue;
    }
    if (line.startsWith("\\subsection{")) {
      number = [number[0], (number[1] ?? 0) + 1];
      entries.push({
        level: 2,
        value: line.slice("\\subsection{".length, -1),
        id: `${id}`,
        /* number, */
      });
      continue;
    }
    if (line.startsWith("\\subsubsection{")) {
      number = [number[0], number[1], (number[2] ?? 0) + 1];
      entries.push({
        level: 3,
        value: line.slice("\\subsubsection{".length, -1),
        id: `${id}`,
        /* number, */
      });
      continue;
    }
    if (line.startsWith("\\paragraph{")) {
      number = [number[0], number[1], number[2], (number[3] ?? 0) + 1];
      entries.push({
        level: 4,
        value: line.slice("\\paragraph{".length, -1),
        id: `${id}`,
        /* number, */
      });
      continue;
    }
    if (line.startsWith("\\subparagraph{")) {
      number = [
        number[0],
        number[1],
        number[2],
        number[3],
        (number[4] ?? 0) + 1,
      ];
      entries.push({
        level: 5,
        value: line.slice("\\subparagraph{".length, -1),
        id: `${id}`,
        /*number,*/
      });
      continue;
    }
  }

  return entries;
}
