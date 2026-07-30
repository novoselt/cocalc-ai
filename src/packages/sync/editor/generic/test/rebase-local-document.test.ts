/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { once } from "@cocalc/util/async-utils";

import { from_str } from "../../db/doc";
import { SyncString } from "../../string/sync";
import { Client, fs } from "../../string/test/client-test";
import { a_txt } from "../../string/test/data";
import { rebaseLocalDocument } from "../rebase-local-document";

function notebookDocument({
  input,
  output,
  execCount,
}: {
  input: string;
  output?: object;
  execCount?: number;
}) {
  return from_str(
    JSON.stringify({
      type: "cell",
      id: "cell-1",
      input,
      output,
      exec_count: execCount,
    }),
    ["type", "id"],
    ["input"],
  );
}

describe("rebaseLocalDocument", () => {
  it("does not restore stale cell output while committing an input edit", () => {
    const oldOutput = { 0: { text: "old", exec_count: 18 } };
    const newOutput = { 0: { text: "new", exec_count: 1 } };
    const base = notebookDocument({
      input: "plot(old)",
      output: oldOutput,
      execCount: 18,
    });
    const draft = base.set({
      type: "cell",
      id: "cell-1",
      input: "plot(new)",
    });
    const committed = base.set({
      type: "cell",
      id: "cell-1",
      output: newOutput,
      exec_count: 1,
    });

    const rebased = rebaseLocalDocument({ base, draft, committed });
    const cell = rebased.get_one({ type: "cell", id: "cell-1" });

    expect(cell.get("input")).toBe("plot(new)");
    expect(cell.get("output").toJS()).toEqual(newOutput);
    expect(cell.get("exec_count")).toBe(1);
  });

  it("uses the committed document when there are no local edits", () => {
    const base = notebookDocument({
      input: "plot()",
      output: { 0: { text: "old" } },
      execCount: 1,
    });
    const committed = base.set({
      type: "cell",
      id: "cell-1",
      output: { 0: { text: "new" } },
      exec_count: 2,
    });

    const rebased = rebaseLocalDocument({
      base,
      draft: base,
      committed,
    });

    expect(rebased.is_equal(committed)).toBe(true);
  });

  it("rebases a SyncDoc draft before creating a merge commit", async () => {
    const base = notebookDocument({
      input: "plot(old)",
      output: { 0: { text: "old" } },
      execCount: 18,
    });
    const draft = base.set({
      type: "cell",
      id: "cell-1",
      input: "plot(new)",
    });
    const committed = base.set({
      type: "cell",
      id: "cell-1",
      output: { 0: { text: "new" } },
      exec_count: 1,
    });
    const commit = jest.fn(() => ({ time: "merge" }));
    const { client_id, project_id, path, init_queries } = a_txt();
    const doc = new SyncString({
      project_id,
      path,
      client: new Client(init_queries, client_id),
      fs,
    });
    await once(doc, "ready");
    const target = doc as any;
    target.doc = draft;
    target.last = base;
    target.my_patches = {};
    target.noAutosave = true;
    target.patchflowSession = {
      commit,
      getDocument: () => committed,
      getHeads: () => ["browser", "kernel"],
      versions: () => ["merge"],
      close: jest.fn(),
    };
    target.patchflowReady = () => true;
    target.emitUserChange = jest.fn();
    target.snapshotIfNecessary = jest.fn();
    target.touchProject = jest.fn();

    expect(target.commit()).toBe(true);
    const merged = commit.mock.calls[0][0];
    const cell = merged.get_one({ type: "cell", id: "cell-1" });

    expect(cell.get("input")).toBe("plot(new)");
    expect(cell.getIn(["output", "0", "text"])).toBe("new");
    expect(cell.get("exec_count")).toBe(1);
    await doc.close();
  });

  it("preserves a local draft when the committed document advances", async () => {
    const { client_id, project_id, path, init_queries } = a_txt();
    const doc = new SyncString({
      project_id,
      path,
      client: new Client(init_queries, client_id),
      fs,
    });
    await once(doc, "ready");
    const target = doc as any;
    const base = target.doc;
    const draft = base.set("local sentence");
    const committed = base.set("filesystem update");
    target.doc = draft;
    target.last = base;
    target.emit_change = jest.fn();

    target.handlePatchflowChange(committed);

    expect(target.last.is_equal(committed)).toBe(true);
    expect(target.doc.to_str()).toContain("local sentence");
    expect(target.doc.to_str()).toContain("filesystem update");
    expect(target.emit_change).toHaveBeenCalledTimes(1);
    await doc.close();
  });
});
