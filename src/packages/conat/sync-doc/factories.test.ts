/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  ensureSyncDocFactories,
  getSyncDocFactories,
  registerSyncDocLoader,
} from "./factories";

describe("SyncDoc capability", () => {
  it("is absent from the core transport until explicitly installed", async () => {
    expect(() => getSyncDocFactories()).toThrow(/not installed/);

    const loader = jest.fn(async () => {
      await import("./install");
    });
    registerSyncDocLoader(loader);
    await Promise.all([ensureSyncDocFactories(), ensureSyncDocFactories()]);

    const factories = getSyncDocFactories();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(factories.string).toEqual(expect.any(Function));
    expect(factories.db).toEqual(expect.any(Function));
    expect(factories.immer).toEqual(expect.any(Function));
  });
});
