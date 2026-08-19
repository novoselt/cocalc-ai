/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { StudentsActions } from "./actions";

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolve0) => {
    resolve = resolve0;
  });
  return { promise, resolve };
}

describe("StudentsActions.add_students", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  it("waits for complete project creation before the final configuration pass", async () => {
    const creationStarted = deferred();
    const finishCreation = deferred<string>();
    let projectId: string | undefined;
    const createStudentProject = jest.fn(async () => {
      creationStarted.resolve();
      projectId = await finishCreation.promise;
      return projectId;
    });
    const configureAllProjects = jest.fn(async () => undefined);
    const store = {
      get_copy_parallel: () => 1,
      get_student: () => ({}),
      getIn: () => projectId,
      wait: (opts) => opts.cb(undefined, opts.until(store)),
    };
    const courseActions = {
      commit: jest.fn(),
      get_store: () => store,
      is_closed: () => false,
      set: jest.fn(),
      set_activity: () => 1,
      set_error: jest.fn(),
      student_projects: {
        configure_all_projects: configureAllProjects,
        create_student_project: createStudentProject,
      },
      syncdb: {
        commit: jest.fn(),
        get_state: () => "ready",
        set: jest.fn(),
        wait_until_ready: jest.fn(async () => undefined),
      },
    };
    const actions = new StudentsActions(courseActions as any);

    const addingStudents = actions.add_students([
      { email_address: "student@example.com" },
    ]);
    await creationStarted.promise;

    expect(configureAllProjects).not.toHaveBeenCalled();

    finishCreation.resolve("11111111-1111-4111-8111-111111111111");
    await addingStudents;

    expect(createStudentProject).toHaveBeenCalledTimes(1);
    expect(configureAllProjects).toHaveBeenCalledTimes(1);
  });

  it("waits for the course document before writing student records", async () => {
    const ready = deferred();
    const syncdb = {
      commit: jest.fn(),
      get_state: () => "init",
      set: jest.fn(),
      wait_until_ready: jest.fn(() => ready.promise),
    };
    const store = {
      get_copy_parallel: () => 1,
      get_student: () => ({}),
      getIn: () => "11111111-1111-4111-8111-111111111111",
      wait: (opts) => opts.cb(undefined, opts.until(store)),
    };
    const courseActions = {
      commit: jest.fn(),
      get_store: () => store,
      is_closed: () => false,
      set: jest.fn(),
      set_activity: () => 1,
      set_error: jest.fn(),
      student_projects: {
        configure_all_projects: jest.fn(async () => undefined),
        create_student_project: jest.fn(async () => undefined),
      },
      syncdb,
    };
    const actions = new StudentsActions(courseActions as any);

    const addingStudents = actions.add_students([
      { email_address: "student@example.com" },
    ]);
    await Promise.resolve();

    expect(syncdb.wait_until_ready).toHaveBeenCalledTimes(1);
    expect(courseActions.set).not.toHaveBeenCalled();
    expect(courseActions.commit).not.toHaveBeenCalled();

    ready.resolve();
    await addingStudents;

    expect(courseActions.set).toHaveBeenCalledTimes(1);
    expect(courseActions.commit).toHaveBeenCalledTimes(1);
  });

  it("stops status polling after the course document closes", async () => {
    const getStore = jest.fn(() => {
      throw Error("store is closed");
    });
    const courseActions = {
      get_store: getStore,
      is_closed: () => true,
      syncdb: { get_state: () => "closed" },
    };
    const actions = new StudentsActions(courseActions as any);

    await expect(actions.updateStudentStatus()).resolves.toBeUndefined();
    await expect(actions.updateDeletedAccounts()).resolves.toBeUndefined();

    expect(getStore).not.toHaveBeenCalled();
  });
});
