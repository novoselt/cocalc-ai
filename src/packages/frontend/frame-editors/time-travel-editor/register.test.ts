/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const registerFileEditor = jest.fn();

jest.mock("../frame-tree/register", () => ({
  register_file_editor: (...args: any[]) => registerFileEditor(...args),
}));

jest.mock("./editor", () => ({
  Editor: function TimeTravelEditor() {},
}));

jest.mock("./actions", () => ({
  TimeTravelActions: class TimeTravelActions {},
}));

import { TimeTravelActions } from "./actions";
import { Editor } from "./editor";
import "./register";

test("TimeTravel keeps synchronous registration for nested editor frames", () => {
  expect(registerFileEditor).toHaveBeenCalledWith({
    ext: "time-travel",
    component: Editor,
    Actions: TimeTravelActions,
  });
});
