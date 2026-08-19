export type Scope = "none" | "selection" | "cell" | "section" | "page" | "all";

// Context handed to the agent, with where it came from.
export interface ContextInfo {
  text: string;
  scope: Scope;
  // 1-based inclusive line range of `text` within the document, when known
  lineStart?: number;
  lineEnd?: number;
  // 1-based line/column the cursor is at, when known.  With no selection this
  // is the only hint about *where in the document* the user is asking about.
  cursorLine?: number;
  cursorColumn?: number;
}
