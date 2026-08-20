import { fromJS } from "immutable";

import {
  doesPersistentCellSatisfyRunCellOverlay,
  getDisplayedCellExecCount,
  getDisplayedCellOutput,
  withDisplayedCellRuntime,
} from "../run-cell-overlay";

describe("jupyter run cell overlay helpers", () => {
  it("prefers overlay output and exec_count while a run is in flight", () => {
    const cell = fromJS({
      id: "c1",
      exec_count: 7,
      output: {
        0: { text: "old" },
      },
    });
    const overlay = fromJS({
      exec_count: 8,
      output: {
        0: { text: "new", exec_count: 8 },
      },
    });

    expect(getDisplayedCellOutput(cell, overlay)?.getIn(["0", "text"])).toBe(
      "new",
    );
    expect(getDisplayedCellExecCount(cell, overlay)).toBe(8);
  });

  it("does not clear the prompt when only output is being replaced", () => {
    const cell = fromJS({
      id: "c1",
      exec_count: 12,
      output: {
        0: { text: "old" },
      },
    });
    const overlay = fromJS({
      output: {
        0: { text: "streaming" },
      },
    });

    expect(getDisplayedCellExecCount(cell, overlay)).toBe(12);
  });

  it("can clear stale output locally without clearing the prompt", () => {
    const cell = fromJS({
      id: "c1",
      exec_count: 13,
      output: {
        0: { text: "old" },
      },
    });
    const overlay = fromJS({
      output: null,
    });

    expect(getDisplayedCellOutput(cell, overlay)).toBeNull();
    expect(getDisplayedCellExecCount(cell, overlay)).toBe(13);
  });

  it("clears the local overlay once durable cell state catches up", () => {
    const overlay = fromJS({
      exec_count: 9,
      output: {
        0: { text: "done", exec_count: 9 },
      },
    });
    const before = fromJS({
      id: "c1",
      exec_count: 8,
      output: {
        0: { text: "old", exec_count: 8 },
      },
    });
    const after = fromJS({
      id: "c1",
      exec_count: 9,
      output: {
        0: { text: "done", exec_count: 9 },
      },
    });

    expect(doesPersistentCellSatisfyRunCellOverlay(before, overlay)).toBe(
      false,
    );
    expect(doesPersistentCellSatisfyRunCellOverlay(after, overlay)).toBe(true);
  });

  it("keeps local running state visible across persistent cell updates", () => {
    const persistent = fromJS({
      id: "c1",
      exec_count: 9,
      output: null,
    });
    const overlay = fromJS({
      state: "busy",
      start: 100,
      end: null,
      exec_count: 9,
      output: null,
    });

    const displayed = withDisplayedCellRuntime(persistent, overlay);
    expect(displayed.get("state")).toBe("busy");
    expect(displayed.get("start")).toBe(100);
    expect(displayed.get("end")).toBeNull();
    expect(doesPersistentCellSatisfyRunCellOverlay(persistent, overlay)).toBe(
      false,
    );
  });

  it("accepts authoritative completion timestamps from the project", () => {
    const overlay = fromJS({
      state: "done",
      start: 100,
      end: 200,
      exec_count: 9,
      output: null,
    });
    const persistent = fromJS({
      id: "c1",
      state: "done",
      start: 110,
      end: 220,
      exec_count: 9,
      output: null,
    });

    expect(doesPersistentCellSatisfyRunCellOverlay(persistent, overlay)).toBe(
      true,
    );
  });
});
