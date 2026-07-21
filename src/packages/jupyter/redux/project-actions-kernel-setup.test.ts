/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { JupyterActions } from "./project-actions";

describe("project-side nbconvert setup", () => {
  it("creates the lightweight kernel wrapper without starting a kernel", () => {
    const ensureKernelIsReady = jest.fn();

    JupyterActions.prototype.ensure_backend_kernel_setup.call({
      ensureKernelIsReady,
    });

    expect(ensureKernelIsReady).toHaveBeenCalledTimes(1);
  });
});
