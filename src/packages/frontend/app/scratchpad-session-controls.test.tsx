/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { Map } from "immutable";
import { setScratchpadDarkMode } from "./scratchpad-session-controls";

describe("scratchpad session controls", () => {
  it("changes only the local account appearance and stores the preference", () => {
    const setState = jest.fn();
    const setItem = jest.fn();
    const appRedux = {
      getStore: () => ({
        get: () => Map({ katex: true, dark_mode: false }),
      }),
      getActions: () => ({ setState }),
    } as any;

    setScratchpadDarkMode(true, {
      appRedux,
      storage: { setItem },
    });

    expect(setState.mock.calls[0][0].other_settings.toJS()).toEqual({
      katex: true,
      dark_mode: true,
    });
    expect(setItem).toHaveBeenCalledWith("cocalc-scratchpad-dark-mode", "1");
  });
});
