/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { kernel } from "../kernel";

describe("Jupyter kernel status", () => {
  it("identifies the kernel generation", () => {
    const instance = kernel({ name: "unused", path: "status.ipynb" });
    expect(instance.getStatus()).toMatchObject({ identity: instance.identity });
    instance.close();
  });
});
