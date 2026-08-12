/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

const mockHasActions = jest.fn();
const mockCreateStore = jest.fn();
const mockCreateActions = jest.fn();

jest.mock("@cocalc/frontend/app-framework", () => ({
  Actions: class {},
  Store: class {},
  redux: {
    hasActions: (...args: unknown[]) => mockHasActions(...args),
    createStore: (...args: unknown[]) => mockCreateStore(...args),
    createActions: (...args: unknown[]) => mockCreateActions(...args),
  },
}));

import { init } from "./init";

beforeEach(() => {
  jest.clearAllMocks();
});

test("creates the legacy Markdown widget store once", () => {
  mockHasActions.mockReturnValue(false);
  init();
  expect(mockCreateStore).toHaveBeenCalledTimes(1);
  expect(mockCreateActions).toHaveBeenCalledTimes(1);

  mockHasActions.mockReturnValue(true);
  init();
  expect(mockCreateStore).toHaveBeenCalledTimes(1);
  expect(mockCreateActions).toHaveBeenCalledTimes(1);
});
