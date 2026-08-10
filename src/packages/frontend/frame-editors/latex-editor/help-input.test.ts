/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getLatexHelpInput } from "./help-input";

describe("getLatexHelpInput", () => {
  it("returns the source through the requested line", () => {
    expect(
      getLatexHelpInput(
        {
          get_state: () => "ready",
          to_str: () => "first\nsecond\nthird\nfourth",
        },
        1,
      ),
    ).toBe("first\nsecond% this is line number 2");
  });

  it("omits source after the syncstring is gone", () => {
    expect(getLatexHelpInput(undefined, 1)).toBe("");
  });

  it("does not read a syncstring that is no longer ready", () => {
    const to_str = jest.fn(() => "source");
    expect(getLatexHelpInput({ get_state: () => "closed", to_str }, 1)).toBe(
      "",
    );
    expect(to_str).not.toHaveBeenCalled();
  });

  it("handles a final synchronous teardown race", () => {
    expect(
      getLatexHelpInput(
        {
          get_state: () => "ready",
          to_str: () => {
            throw Error("closed");
          },
        },
        1,
      ),
    ).toBe("");
  });
});
