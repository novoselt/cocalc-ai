/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { CourseActions } from "./actions";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolve0) => {
    resolve = resolve0;
  });
  return { promise, resolve };
}

describe("CourseActions SyncDB mutations", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("preserves pre-ready set, delete, and commit operations in order", async () => {
    const ready = deferred();
    const events: string[] = [];
    let state = "init";
    const syncdb = {
      commit: jest.fn(() => events.push("commit")),
      delete: jest.fn(() => events.push("delete")),
      get_state: jest.fn(() => state),
      set: jest.fn((obj: { student_id?: string }) =>
        events.push(`set:${obj.student_id}`),
      ),
      wait_until_ready: jest.fn(() => ready.promise),
    };
    const store = {
      get: jest.fn(),
    };
    const redux = {
      _set_state: jest.fn(),
      getStore: jest.fn(() => store),
    };
    const actions = new CourseActions("course", redux as any);
    actions.syncdb = syncdb as any;

    actions.set(
      { table: "students", student_id: "student-1", note: "hello" },
      false,
    );
    actions.delete({ table: "students", student_id: "student-2" }, false);
    actions.commit();

    expect(events).toEqual([]);
    expect(syncdb.wait_until_ready).toHaveBeenCalledTimes(1);

    state = "ready";
    actions.set(
      { table: "students", student_id: "student-3", note: "later" },
      false,
    );
    expect(events).toEqual([]);
    const drain = (actions as any).syncdbMutationDrain;
    ready.resolve();
    await drain;

    expect(events).toEqual([
      "set:student-1",
      "delete",
      "commit",
      "set:student-3",
    ]);
  });

  it("ignores late errors after the course store is removed", () => {
    const redux = {
      _set_state: jest.fn(),
      getStore: jest.fn(() => undefined),
    };
    const actions = new CourseActions("course", redux as any);

    expect(() => actions.set_error("late SyncDB failure")).not.toThrow();
    expect(actions.is_closed()).toBe(true);
    expect(redux._set_state).not.toHaveBeenCalled();
  });
});
