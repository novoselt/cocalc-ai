/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  interleaveSubfileTocEntries,
  parseTableOfContents,
  scanIncludeDirectives,
} from "./table-of-contents";

const DOC = [
  "\\documentclass{article}",
  "% bookmark: review-intro",
  "\\section{One}",
  "text  % chat: abc12345",
  "\\subsection{Two}",
  "% chat: abc12345",
  "% chat: def67890",
  "% bookmark: review-intro",
].join("\n");

describe("parseTableOfContents", () => {
  it("returns only headings by default", () => {
    const entries = parseTableOfContents(DOC);
    expect(entries.map((e) => e.value)).toEqual(["One", "Two"]);
  });

  it("overlays chat markers and bookmarks in document order, deduped", () => {
    const entries = parseTableOfContents(DOC, {
      includeChatMarkers: true,
      includeBookmarks: true,
    });
    expect(entries.map((e) => e.value)).toEqual([
      "review-intro", // line 2 bookmark (first occurrence only)
      "One", // line 3
      "Chat abc12345 (line 4)", // first occurrence of abc12345 only
      "Two", // line 5
      "Chat def67890 (line 7)",
    ]);
    const chat = entries.find((e) => e.extra?.kind === "chat");
    expect(chat?.extra).toEqual({ kind: "chat", hash: "abc12345" });
    // ids parseInt to the 1-based target line
    expect(parseInt(chat!.id)).toBe(4);
  });

  it("keeps heading ids as plain line numbers", () => {
    const entries = parseTableOfContents(DOC, { includeChatMarkers: true });
    const heading = entries.find((e) => e.value === "One");
    expect(heading?.id).toBe("3");
  });

  it("parses nested braces and ignores trailing chat comments", () => {
    const entries = parseTableOfContents(
      "\\section{One \\textbf{bold}} % chat: abc12345",
      { includeChatMarkers: true },
    );
    expect(entries.map((e) => e.value)).toEqual([
      "One \\textbf{bold}",
      "Chat abc12345 (line 1)",
    ]);
  });
});

describe("scanIncludeDirectives", () => {
  it("finds include and input commands while ignoring comments", () => {
    const latex = [
      "\\include{chapter-one}",
      "text % \\include{commented}",
      "\\input {parts/chapter-two.tex}",
      "escaped \\% \\input{chapter-three}",
      "\\includeonly{chapter-one}",
    ].join("\n");
    expect(scanIncludeDirectives(latex)).toEqual([
      { line: 1, target: "chapter-one" },
      { line: 3, target: "parts/chapter-two.tex" },
      { line: 4, target: "chapter-three" },
    ]);
  });
});

describe("interleaveSubfileTocEntries", () => {
  it("places a subfile group at its include directive", () => {
    const masterLatex = [
      "\\section{Before}",
      "% bookmark: before-include",
      "\\include{123}",
      "% bookmark: after-include",
      "\\section{After}",
    ].join("\n");
    const masterEntries = parseTableOfContents(masterLatex, {
      includeBookmarks: true,
    });
    const result = interleaveSubfileTocEntries({
      masterEntries,
      masterLatex,
      masterPath: "latex/tex.tex",
      groups: [
        {
          path: "latex/123.tex",
          entries: [
            { id: "sub:123:file", value: "**123.tex**", icon: "tex-file" },
            {
              id: "sub:123:1-heading",
              value: "Inside 123",
              level: 1,
            },
          ],
        },
      ],
    });

    expect(result.map(({ value }) => value)).toEqual([
      "Before",
      "before-include",
      "**123.tex**",
      "Inside 123",
      "after-include",
      "After",
    ]);
  });

  it("matches input paths with explicit extensions", () => {
    const masterLatex = [
      "\\section{Before}",
      "\\input{parts/chapter.tex}",
      "\\section{After}",
    ].join("\n");
    const result = interleaveSubfileTocEntries({
      masterEntries: parseTableOfContents(masterLatex),
      masterLatex,
      masterPath: "latex/tex.tex",
      groups: [
        {
          path: "latex/parts/chapter.tex",
          entries: [{ id: "sub:chapter:file", value: "**chapter.tex**" }],
        },
      ],
    });
    expect(result.map(({ value }) => value)).toEqual([
      "Before",
      "**chapter.tex**",
      "After",
    ]);
  });

  it("appends unmatched groups and inserts a repeated include only once", () => {
    const masterLatex = [
      "\\include{123}",
      "\\include{123}",
      "\\section{After}",
    ].join("\n");
    const result = interleaveSubfileTocEntries({
      masterEntries: parseTableOfContents(masterLatex),
      masterLatex,
      masterPath: "latex/tex.tex",
      groups: [
        {
          path: "latex/unmatched.tex",
          entries: [{ id: "sub:unmatched:file", value: "**unmatched.tex**" }],
        },
        {
          path: "latex/123.tex",
          entries: [{ id: "sub:123:file", value: "**123.tex**" }],
        },
      ],
    });
    expect(result.map(({ value }) => value)).toEqual([
      "**123.tex**",
      "After",
      "**unmatched.tex**",
    ]);
  });
});
