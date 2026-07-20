/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import handleChange from "./handle-nbconvert-change";

describe("project-side nbconvert state", () => {
  it("reports the actual converter output path", async () => {
    const states: any[] = [];
    const actions: any = {
      ensure_backend_kernel_setup: jest.fn(() => {
        actions.jupyter_kernel = {
          nbconvert: jest.fn(async () => ({
            output: "/home/user/analysis.txt",
          })),
        };
      }),
      jupyter_kernel: undefined,
      save_ipynb_file: jest.fn(async () => {}),
      set_runtime_nbconvert: jest.fn((state) => states.push(state)),
    };

    await handleChange(actions, undefined, {
      args: ["--to", "script"],
      state: "start",
    });

    expect(actions.ensure_backend_kernel_setup).toHaveBeenCalledTimes(1);
    expect(states.at(-1)).toEqual(
      expect.objectContaining({
        args: ["--to", "script"],
        error: null,
        output: "/home/user/analysis.txt",
        state: "done",
      }),
    );
  });

  it("accepts a successful void result from an older project process", async () => {
    const states: any[] = [];
    const actions: any = {
      ensure_backend_kernel_setup: jest.fn(() => {
        actions.jupyter_kernel = {
          nbconvert: jest.fn(async () => undefined),
        };
      }),
      jupyter_kernel: undefined,
      save_ipynb_file: jest.fn(async () => {}),
      set_runtime_nbconvert: jest.fn((state) => states.push(state)),
    };

    await handleChange(actions, undefined, {
      args: ["--to", "html"],
      state: "start",
    });

    expect(states.at(-1)).toEqual(
      expect.objectContaining({ error: null, state: "done" }),
    );
  });
});
