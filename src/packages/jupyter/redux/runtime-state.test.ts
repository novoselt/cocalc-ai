import {
  isActiveJupyterRuntimeCellState,
  normalizeJupyterRuntimeCellState,
  recoverJupyterRuntimeCellState,
  type JupyterRuntimeCellState,
} from "./runtime-state";

describe("normalizeJupyterRuntimeCellState", () => {
  it("preserves cells that are already done", () => {
    const state: JupyterRuntimeCellState = {
      state: "done",
      start: 10,
      end: 20,
    };
    expect(normalizeJupyterRuntimeCellState(state)).toBe(state);
  });

  it("coerces stale busy state with an end time back to done", () => {
    expect(
      normalizeJupyterRuntimeCellState({
        state: "busy",
        start: 10,
        end: 20,
      }),
    ).toEqual({
      state: "done",
      start: 10,
      end: 20,
    });
  });

  it("recovers a terminal end field omitted from the object manifest", () => {
    expect(
      recoverJupyterRuntimeCellState({ state: "busy", start: 10 }, 20),
    ).toEqual({ state: "done", start: 10, end: 20 });
  });

  it("does not recover an end field belonging to an earlier run", () => {
    expect(
      recoverJupyterRuntimeCellState({ state: "busy", start: 20 }, 10),
    ).toEqual({ state: "busy", start: 20 });
    expect(
      normalizeJupyterRuntimeCellState({
        state: "busy",
        start: 20,
        end: 10,
      }),
    ).toEqual({ state: "busy", start: 20, end: 10 });
  });

  it("identifies only live running states as active", () => {
    expect(isActiveJupyterRuntimeCellState({ state: "run" })).toBe(true);
    expect(isActiveJupyterRuntimeCellState({ state: "busy" })).toBe(true);
    expect(
      isActiveJupyterRuntimeCellState({
        state: "busy",
        start: 10,
        end: 20,
      }),
    ).toBe(false);
    expect(isActiveJupyterRuntimeCellState({ state: "done" })).toBe(false);
    expect(isActiveJupyterRuntimeCellState(undefined)).toBe(false);
  });
});
