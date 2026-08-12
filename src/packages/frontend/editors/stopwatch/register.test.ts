/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

const mockRegisterFileEditor = jest.fn();
const mockInitialize = jest.fn(async () => "stopwatch-store");
const mockRemove = jest.fn(() => "stopwatch-store");
const MockEditor = () => null;

jest.mock("@cocalc/frontend/app-framework", () => ({
  redux_name: (projectId: string, path: string) => `${projectId}-${path}`,
}));

jest.mock("@cocalc/frontend/project-file", () => ({
  register_file_editor: (options: unknown) => mockRegisterFileEditor(options),
}));

jest.mock("./runtime", () => ({
  __esModule: true,
  default: MockEditor,
  initialize: (...args: unknown[]) => mockInitialize(...args),
  remove: (...args: unknown[]) => mockRemove(...args),
}));

import "./register";

test("registers metadata and loads the stopwatch implementation on demand", async () => {
  expect(mockRegisterFileEditor).toHaveBeenCalledTimes(1);
  const registration = mockRegisterFileEditor.mock.calls[0][0];
  expect(registration).toMatchObject({
    ext: ["time"],
    icon: "stopwatch",
  });
  expect(registration.component).toBeUndefined();

  expect(await registration.componentAsync()).toBe(MockEditor);
  expect(await registration.initAsync("clock.time", {}, "project-1")).toBe(
    "stopwatch-store",
  );
  expect(mockInitialize).toHaveBeenCalledWith("clock.time", {}, "project-1");

  expect(registration.remove("clock.time", {}, "project-1")).toBe(
    "stopwatch-store",
  );
  expect(mockRemove).toHaveBeenCalledWith("clock.time", {}, "project-1");
});
