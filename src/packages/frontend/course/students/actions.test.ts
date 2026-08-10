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
      get_store: () => store,
      is_closed: () => false,
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
});
