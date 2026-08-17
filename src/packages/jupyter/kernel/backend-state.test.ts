/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { kernel } from "./kernel";

describe("Jupyter backend state transitions", () => {
  it("records last_backend_state whenever backend_state changes", () => {
    const set_runtime_settings = jest.fn();
    const before = Date.now();
    const instance = kernel({
      name: "unused",
      path: "backend-state.ipynb",
      actions: { set_runtime_settings } as any,
    });

    // The constructor moves the kernel to "off".
    const settings = set_runtime_settings.mock.calls.at(-1)?.[0];
    expect(settings?.backend_state).toBe("off");
    // Without this the run progress meter has no baseline and stays at 0.
    expect(settings?.last_backend_state).toBeGreaterThanOrEqual(before);
    expect(settings?.last_backend_state).toBeLessThanOrEqual(Date.now());

    instance.close();
  });
});
