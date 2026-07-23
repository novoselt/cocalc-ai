/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { IpywidgetsState } from "../ipywidgets-state";

describe("IpywidgetsState.getSerializedModelState", () => {
  it("returns undefined while the state table is initializing", () => {
    const state = new IpywidgetsState(
      {} as any,
      { is_project: () => false } as any,
      jest.fn(),
    );

    expect(state.get_state()).toBe("init");
    expect(state.getSerializedModelState("model-1")).toBeUndefined();
  });

  it("reads model state after initialization", async () => {
    const stringId = "string-1";
    const records = new Map([
      [
        JSON.stringify([stringId, "model-1", "state"]),
        {
          get: (field: string) =>
            field === "data"
              ? {
                  toJS: () => ({ _model_name: "IntSliderModel", value: 5 }),
                }
              : undefined,
        },
      ],
    ]);
    const table = {
      get: (key: string) => records.get(key),
      on: jest.fn(),
    };
    const state = new IpywidgetsState(
      { get_string_id: () => stringId } as any,
      { is_project: () => false } as any,
      jest.fn(async () => table),
    );

    await state.init();

    expect(state.get_state()).toBe("ready");
    expect(state.getSerializedModelState("model-1")).toEqual({
      _model_name: "IntSliderModel",
      value: 5,
    });
  });
});
