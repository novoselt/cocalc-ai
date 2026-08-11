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

  it("shares one retrying load between async component and initialization", async () => {
    const Editor = () => null;
    class Actions {}
    const editor = jest.fn(async () => ({ Editor }));
    const actions = jest.fn(async () => ({ Actions }));
    register_file_editor({
      ext: `async-${Date.now()}-${Math.random()}`,
      codemirror: true,
      editor,
      actions,
    });
    const registration = generalRegisterFileEditor.mock.calls[0][0];
    const initializedActions = { _init: jest.fn() };
    const redux = {
      getActions: jest.fn(() => undefined),
      createStore: jest.fn(() => ({})),
      createActions: jest.fn(() => initializedActions),
    };

    const [component, name] = await Promise.all([
      registration.componentAsync(),
      registration.initAsync("test.py", redux, "project-1"),
    ]);

    expect(component).toBe(Editor);
    expect(name).toBe("project-1:test.py");
    expect(editor).toHaveBeenCalledTimes(1);
    expect(actions).toHaveBeenCalledTimes(1);
    expect(initializedActions._init).toHaveBeenCalledTimes(1);
  });
});
