/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const generalRegisterFileEditor = jest.fn();

jest.mock("@cocalc/frontend/file-editors", () => ({
  register_file_editor: (...args: any[]) => generalRegisterFileEditor(...args),
}));

jest.mock("@cocalc/frontend/app-framework", () => ({
  redux_name: (project_id: string, path: string) => `${project_id}:${path}`,
}));

jest.mock("@cocalc/frontend/editor-load-diagnostics", () => ({
  warnEditorLoadFailure: jest.fn(),
}));

import { register_file_editor } from "./register";

describe("frame editor registration cleanup", () => {
  beforeEach(() => {
    generalRegisterFileEditor.mockReset();
  });

  it("removes a partially initialized action without a close hook", () => {
    register_file_editor({
      ext: `cleanup-${Date.now()}-${Math.random()}`,
      component: () => null,
      Actions: class {},
    });
    const registration = generalRegisterFileEditor.mock.calls[0][0];
    const actions = {};
    const store = { state: {} };
    const redux = {
      getActions: jest.fn(() => actions),
      removeActions: jest.fn(),
      getProjectStore: jest.fn(() => undefined),
      getStore: jest.fn(() => store),
      removeStore: jest.fn(),
    };

    expect(() =>
      registration.remove("/home/user/test.txt", redux, "project-1"),
    ).not.toThrow();
    expect(redux.removeActions).toHaveBeenCalledWith(
      "project-1:/home/user/test.txt",
    );
    expect(redux.removeStore).toHaveBeenCalledWith(
      "project-1:/home/user/test.txt",
    );
  });
});
