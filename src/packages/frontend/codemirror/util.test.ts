/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

const mockGet = jest.fn();
const mockDel = jest.fn();
const mockWarn = jest.fn();

jest.mock("@cocalc/frontend/misc/local-storage-typed", () => ({
  del: (...args: any[]) => mockDel(...args),
  get: (...args: any[]) => mockGet(...args),
  set: jest.fn(),
}));

jest.mock("@cocalc/conat/logger", () => ({
  getLogger: () => ({ warn: (...args: any[]) => mockWarn(...args) }),
}));

import { initFold, setFoldedLines } from "./util";

describe("CodeMirror persisted fold state", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("contains overlapping fold failures and continues restoring", () => {
    const lines = [3, 4];
    const foldCode = jest.fn((line: number) => {
      if (line === 4) {
        throw Error(
          "Inserting collapsed marker partially overlapping an existing one",
        );
      }
    });

    expect(setFoldedLines({ foldCode }, lines)).toBe(false);
    expect(foldCode.mock.calls).toEqual([[4], [3]]);
    expect(lines).toEqual([3, 4]);
    expect(mockWarn).toHaveBeenCalledTimes(1);
  });

  it("discards persisted state after a partial restore", () => {
    mockGet.mockReturnValue([3, 4]);
    const foldCode = jest.fn((line: number) => {
      if (line === 4) throw Error("overlapping fold");
    });

    initFold({ foldCode }, "project\\file");

    expect(mockDel).toHaveBeenCalledWith("cmfold-project\\file");
  });
});
