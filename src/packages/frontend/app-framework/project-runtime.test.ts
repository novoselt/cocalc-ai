/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  initializeProjectStore,
  registerProjectStoreInitializer,
} from "./project-runtime";

describe("project Redux runtime registration", () => {
  it("requires explicit registration and preserves synchronous initialization", () => {
    expect(() => initializeProjectStore("project-1", {} as any)).toThrow(
      /project runtime is not loaded/,
    );

    const store = { project_id: "project-1" } as any;
    const initializer = jest.fn(() => store);
    registerProjectStoreInitializer(initializer);

    expect(initializeProjectStore("project-1", {} as any)).toBe(store);
    expect(initializer).toHaveBeenCalledWith("project-1", {});

    expect(() => registerProjectStoreInitializer(initializer)).not.toThrow();
    expect(() => registerProjectStoreInitializer(jest.fn(() => store))).toThrow(
      /already registered/,
    );
  });
});
