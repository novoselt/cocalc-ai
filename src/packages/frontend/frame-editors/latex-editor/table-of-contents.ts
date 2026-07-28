/*
A quick naive table of contents implementation, at least for the master document.

This isn't sophisticated at all.  We also don't include the numbers even though we compute
them, since it's too easy to mess them up by including subfiles or using macros to
change them.
*/

import { TableOfContentsEntry as Entry } from "@cocalc/frontend/components";
import { normalize as pathNormalize } from "path";

import { scanBookmarks, scanMarkers } from "./chat-markers";

export interface ChatTocExtra {
  kind: "chat";
  hash: string;
  path?: string;
}

export interface ParseTableOfContentsOptions {
  // Overlay `% chat: <hash>` markers as entries (deduped by hash,
  // first occurrence wins).
  includeChatMarkers?: boolean;
  // Overlay `% bookmark: <text>` comments as entries (deduped by text).
  includeBookmarks?: boolean;
}

export interface IncludeDirective {
  line: number; // 1-based source line
  target: string;
}

export interface SubfileTocGroup {
  path: string;
  entries: Entry[];
}

function stripLatexComment(line: string): string {
  for (let i = 0; i < line.length; i += 1) {
    if (line[i] !== "%") continue;
    let backslashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === "\\"; j -= 1) {
      backslashes += 1;
    }
    if (backslashes % 2 === 0) {
      return line.slice(0, i);
    }
  }
  return line;
}

export function scanIncludeDirectives(latex: string): IncludeDirective[] {
  const directives: IncludeDirective[] = [];
  const pattern = /\\(?:include|input)\s*\{([^{}]+)\}/g;
  for (const [index, rawLine] of latex.split("\n").entries()) {
    const line = stripLatexComment(rawLine);
    pattern.lastIndex = 0;
    for (
      let match = pattern.exec(line);
      match != null;
      match = pattern.exec(line)
    ) {
      const target = match[1].trim();
      if (target) {
        directives.push({ line: index + 1, target });
      }
    }
  }
  return directives;
}

function normalizeTocPath(path: string): string {
  const normalized = pathNormalize(path).replace(/\\/g, "/");
  return normalized.startsWith("./") ? normalized.slice(2) : normalized;
}

function resolveIncludePath({
  target,
  masterPath,
  candidates,
  canonicalPaths,
}: {
  target: string;
  masterPath: string;
  candidates: Map<string, string>;
  canonicalPaths?: Readonly<Record<string, string>>;
}): string | undefined {
  const targetWithExtension = /\.[^/]+$/.test(target)
    ? target
    : `${target}.tex`;
  const slash = masterPath.lastIndexOf("/");
  const directory = slash === -1 ? "" : masterPath.slice(0, slash);
  const relative = normalizeTocPath(
    directory ? `${directory}/${targetWithExtension}` : targetWithExtension,
  );
  const direct = normalizeTocPath(targetWithExtension);
  const lexical = candidates.get(relative) ?? candidates.get(direct);
  if (lexical != null) return lexical;
  for (const alias of [relative, direct]) {
    const canonical = canonicalPaths?.[alias];
    if (canonical == null) continue;
    const resolved = candidates.get(normalizeTocPath(canonical));
    if (resolved != null) return resolved;
  }
  return undefined;
}

function instantiateSubfileGroup(
  group: SubfileTocGroup,
  occurrence: number,
): Entry[] {
  const last = group.entries.length - 1;
  return group.entries.map((entry, index) => ({
    ...entry,
    id: `${entry.id}:instance-${occurrence}`,
    extra: {
      ...(entry.extra ?? {}),
      tocGroupPath: group.path,
      tocGroupBoundary:
        index === 0 && index === last
          ? "both"
          : index === 0
            ? "start"
            : index === last
              ? "end"
              : undefined,
    },
  }));
}

// Insert each known subfile group at every matching \include/\input directive.
// Groups whose directive cannot be resolved stay visible at the end as a
// fallback.
export function interleaveSubfileTocEntries({
  masterEntries,
  masterLatex,
  masterPath,
  groups,
  canonicalPaths,
}: {
  masterEntries: Entry[];
  masterLatex: string;
  masterPath: string;
  groups: SubfileTocGroup[];
  canonicalPaths?: Readonly<Record<string, string>>;
}): Entry[] {
  if (groups.length === 0) return masterEntries;
  const candidates = new Map(
    groups.map(({ path }) => [normalizeTocPath(path), path]),
  );
  const groupByPath = new Map(groups.map((group) => [group.path, group]));
  const placedPaths = new Set<string>();
  const occurrenceByPath = new Map<string, number>();
  const placements: Array<{ line: number; entries: Entry[] }> = [];
  for (const directive of scanIncludeDirectives(masterLatex)) {
    const path = resolveIncludePath({
      target: directive.target,
      masterPath,
      candidates,
      canonicalPaths,
    });
    if (!path) continue;
    const group = groupByPath.get(path);
    if (group == null) continue;
    placedPaths.add(path);
    const occurrence = (occurrenceByPath.get(path) ?? 0) + 1;
    occurrenceByPath.set(path, occurrence);
    placements.push({
      line: directive.line,
      entries: instantiateSubfileGroup(group, occurrence),
    });
  }

  const result: Entry[] = [];
  let masterIndex = 0;
  for (const { line, entries } of placements) {
    while (
      masterIndex < masterEntries.length &&
      parseInt(masterEntries[masterIndex].id) <= line
    ) {
      result.push(masterEntries[masterIndex]);
      masterIndex += 1;
    }
    result.push(...entries);
  }
  result.push(...masterEntries.slice(masterIndex));
  for (const group of [...groups].sort((a, b) =>
    a.path.localeCompare(b.path),
  )) {
    if (!placedPaths.has(group.path)) {
      result.push(...instantiateSubfileGroup(group, 1));
    }
  }
  return result;
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
        level: 6,
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
        level: 6,
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
    const section = extractHeading(line, "\\section{");
    if (section != null) {
      number = [number[0] + 1];
      entries.push({
        level: 1,
        value: section,
        id: `${id}`,
        /*number, */
      });
      continue;
    }
    const subsection = extractHeading(line, "\\subsection{");
    if (subsection != null) {
      number = [number[0], (number[1] ?? 0) + 1];
      entries.push({
        level: 2,
        value: subsection,
        id: `${id}`,
        /* number, */
      });
      continue;
    }
    const subsubsection = extractHeading(line, "\\subsubsection{");
    if (subsubsection != null) {
      number = [number[0], number[1], (number[2] ?? 0) + 1];
      entries.push({
        level: 3,
        value: subsubsection,
        id: `${id}`,
        /* number, */
      });
      continue;
    }
    const paragraph = extractHeading(line, "\\paragraph{");
    if (paragraph != null) {
      number = [number[0], number[1], number[2], (number[3] ?? 0) + 1];
      entries.push({
        level: 4,
        value: paragraph,
        id: `${id}`,
        /* number, */
      });
      continue;
    }
    const subparagraph = extractHeading(line, "\\subparagraph{");
    if (subparagraph != null) {
      number = [
        number[0],
        number[1],
        number[2],
        number[3],
        (number[4] ?? 0) + 1,
      ];
      entries.push({
        level: 5,
        value: subparagraph,
        id: `${id}`,
        /*number,*/
      });
      continue;
    }
  }

  return entries;
}

// Extract a section command argument while respecting nested braces.  The
// command's closing brace need not be the final character on the line: a
// comment, including a chat marker, may follow it.
function extractHeading(line: string, prefix: string): string | null {
  if (!line.startsWith(prefix)) {
    return null;
  }
  let depth = 1;
  for (let i = prefix.length; i < line.length; i += 1) {
    if (line[i] === "{") {
      depth += 1;
    } else if (line[i] === "}") {
      depth -= 1;
      if (depth === 0) {
        return line.slice(prefix.length, i);
      }
    }
  }
  return null;
}
