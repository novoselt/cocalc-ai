/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import { ChangeSet } from "@codemirror/state";
import { apply_patch } from "@cocalc/util/dmp";
import { CodeMirrorEditJournal } from "./edit-journal";

describe("CodeMirror edit journal", () => {
  it("composes editor operations without diffing whole documents", () => {
    const journal = new CodeMirrorEditJournal("hello world");
    journal.record(ChangeSet.of({ from: 6, to: 11, insert: "CoCalc" }, 11));
    journal.record(ChangeSet.of({ from: 12, insert: "!" }, 12));
    const batch = journal.getBatch();
    expect(batch?.value).toBe("hello CoCalc!");
    expect(apply_patch(batch!.patch, batch!.base)).toEqual([
      "hello CoCalc!",
      true,
    ]);
  });

  it("resets after an acknowledged checkpoint", () => {
    const journal = new CodeMirrorEditJournal("a");
    journal.record(ChangeSet.of({ from: 1, insert: "b" }, 1));
    expect(journal.getBatch()).toBeDefined();
    journal.reset("ab");
    expect(journal.getBatch()).toBeUndefined();
  });
});
