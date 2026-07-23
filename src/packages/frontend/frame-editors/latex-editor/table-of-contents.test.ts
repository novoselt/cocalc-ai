/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { parseTableOfContents } from "./table-of-contents";

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
});
