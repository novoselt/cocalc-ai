/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

/*
Regression test for a long-standing typo: `ProjectActions.goto_line` called
`programmatical_goto_line` while the frame editors implement
`programmatically_goto_line`.  Since the call site typed the editor actions as
`any` and guarded with `?.`, the mismatch was a silent no-op rather than an
error, so clicking another user's avatar to jump to their line did nothing.
*/

import { redux } from "@cocalc/frontend/app-framework";
import { ProjectActions } from "./redux/actions";
import { BaseEditorActions } from "@cocalc/frontend/frame-editors/base-editor/actions-base";

describe("jumping to a line in an open editor", () => {
  const project_id = "8b9bc8ff-4a2d-4e2a-9b1b-3f4a51d5f8a1";

  function projectActions() {
    const actions = Object.create(ProjectActions.prototype) as ProjectActions;
    // goto_line only needs the sync path lookup, which has no open files here.
    (actions as any).project_id = project_id;
    (actions as any).open_files = undefined;
    (actions as any).getHomeDirectoryForPaths = () => "/home/user";
    return actions;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("calls the method the frame editors actually implement", () => {
    const programmatically_goto_line = jest.fn();
    jest
      .spyOn(redux, "getEditorActions")
      .mockReturnValue({ programmatically_goto_line } as any);

    projectActions().goto_line("a.md", 42, true, false);

    expect(programmatically_goto_line).toHaveBeenCalledWith(42, true, false);
  });

  it("does nothing when the editor has no such method", () => {
    jest.spyOn(redux, "getEditorActions").mockReturnValue({} as any);

    expect(() => projectActions().goto_line("a.md", 42)).not.toThrow();
  });

  it("the base frame editor actually provides that method", () => {
    // The half of the contract that TypeScript cannot check, because
    // goto_line types the editor actions as `any`.
    expect(typeof BaseEditorActions.prototype.programmatically_goto_line).toBe(
      "function",
    );
  });
});
