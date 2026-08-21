/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

// A terminal frame can live in any editor, not only in a .term file, so the
// accessor for its live terminal has to be on the base editor actions.  When
// it was only on the terminal editor's actions, the agent prompt for a
// terminal frame inside e.g. a notebook carried no session id at all.

import { BaseEditorActions } from "@cocalc/frontend/frame-editors/base-editor/actions-base";

describe("BaseEditorActions.get_terminal", () => {
  it("is available to every editor's actions", () => {
    expect(typeof (BaseEditorActions as any).prototype.get_terminal).toBe(
      "function",
    );
  });
});
