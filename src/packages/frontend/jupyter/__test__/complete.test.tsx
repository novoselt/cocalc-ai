import { Map, fromJS } from "immutable";
import { fireEvent, render, screen } from "@testing-library/react";

const saveInputEditor = jest.fn();
const setMode = jest.fn();
const useNotebookFrameActions = jest.fn(() => ({
  current: {
    save_input_editor: saveInputEditor,
    set_mode: setMode,
  },
}));

jest.mock(
  "@cocalc/frontend/frame-editors/jupyter-editor/cell-notebook/hook",
  () => () => useNotebookFrameActions(),
);

import { Complete } from "../complete";

describe("Jupyter completion menu", () => {
  beforeEach(() => {
    saveInputEditor.mockReset();
    setMode.mockReset();
  });

  it("selects a completion on mouse down before blur can clear the menu", () => {
    const select_complete = jest.fn();
    const clear_complete = jest.fn();
    const focus_complete = jest.fn();
    jest.useFakeTimers();
    const complete = fromJS({
      base: "i",
      code: "i",
      cursor_end: 1,
      cursor_start: 0,
      matches: ["input"],
      offset: { top: 0, bottom: 10, left: 0 },
    }) as Map<string, any>;

    render(
      <Complete
        actions={{ select_complete, clear_complete, focus_complete }}
        id="cell-1"
        complete={complete}
      />,
    );

    fireEvent.mouseDown(screen.getByRole("option", { name: "input" }));
    jest.runAllTimers();

    expect(saveInputEditor).toHaveBeenCalledWith("cell-1");
    expect(select_complete).toHaveBeenCalledWith("cell-1", "input", complete);
    expect(focus_complete).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("falls back to the first completion on enter if focus lookup is lost", () => {
    const select_complete = jest.fn();
    const clear_complete = jest.fn();
    const focus_complete = jest.fn();
    jest.useFakeTimers();
    const complete = fromJS({
      base: "i",
      code: "i",
      cursor_end: 1,
      cursor_start: 0,
      matches: ["input", "int"],
      offset: { top: 0, bottom: 10, left: 0 },
    }) as Map<string, any>;

    render(
      <Complete
        actions={{ select_complete, clear_complete, focus_complete }}
        id="cell-1"
        complete={complete}
      />,
    );

    fireEvent.keyDown(document, { key: "Enter" });
    jest.runAllTimers();

    expect(select_complete).toHaveBeenCalledWith("cell-1", "input", complete);
    expect(focus_complete).toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("uses arrow keys to move through completions without scrolling the page", () => {
    const complete = fromJS({
      base: "i",
      code: "i",
      cursor_end: 1,
      cursor_start: 0,
      matches: ["input", "int", "isinstance"],
      offset: { top: 10, bottom: 20, left: 30 },
    }) as Map<string, any>;

    render(
      <Complete
        actions={{
          select_complete: jest.fn(),
          clear_complete: jest.fn(),
        }}
        id="cell-1"
        complete={complete}
      />,
    );

    const input = screen.getByRole("option", { name: "input" });
    const int = screen.getByRole("option", { name: "int" });
    expect(input).toHaveAttribute("aria-selected", "true");

    const moved = fireEvent.keyDown(document, { key: "ArrowDown" });

    expect(moved).toBe(false);
    expect(input).toHaveAttribute("aria-selected", "false");
    expect(int).toHaveAttribute("aria-selected", "true");
  });

  it("accepts the selected completion against the current input with Tab", () => {
    const select_complete = jest.fn();
    const complete = fromJS({
      base: "i",
      code: "i",
      cursor_end: 1,
      cursor_start: 0,
      matches: ["input", "int"],
      offset: { top: 10, bottom: 20, left: 30 },
    }) as Map<string, any>;

    render(
      <Complete
        actions={{ select_complete, clear_complete: jest.fn() }}
        id="cell-1"
        complete={complete}
        code="in"
        cursorIndex={2}
        filterText="in"
      />,
    );

    fireEvent.keyDown(document, { key: "ArrowDown" });
    fireEvent.keyDown(document, { key: "Tab" });

    const selectedComplete = select_complete.mock.calls[0][2] as Map<
      string,
      any
    >;
    expect(select_complete.mock.calls[0].slice(0, 2)).toEqual([
      "cell-1",
      "int",
    ]);
    expect(selectedComplete.get("base")).toBe("in");
    expect(selectedComplete.get("code")).toBe("in");
    expect(selectedComplete.get("cursor_end")).toBe(2);
  });

  it("filters additional typing and restores options after backspace", () => {
    const complete = fromJS({
      base: "i",
      code: "i",
      cursor_end: 1,
      cursor_start: 0,
      matches: ["_ih", "_ii", "input", "int", "isinstance"],
      offset: { top: 10, bottom: 20, left: 30 },
    }) as Map<string, any>;
    const actions = {
      select_complete: jest.fn(),
      clear_complete: jest.fn(),
    };
    const view = render(
      <Complete
        actions={actions}
        id="cell-1"
        complete={complete}
        code="i"
        cursorIndex={1}
        filterText="i"
      />,
    );

    expect(screen.getAllByRole("option")).toHaveLength(3);
    expect(screen.queryByRole("option", { name: "_ih" })).toBeNull();

    view.rerender(
      <Complete
        actions={actions}
        id="cell-1"
        complete={complete}
        code="in"
        cursorIndex={2}
        filterText="in"
      />,
    );
    expect(screen.getAllByRole("option")).toHaveLength(2);
    expect(screen.getByRole("option", { name: "input" })).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "int" })).toBeInTheDocument();

    view.rerender(
      <Complete
        actions={actions}
        id="cell-1"
        complete={complete}
        code="i"
        cursorIndex={1}
        filterText="i"
      />,
    );
    expect(screen.getAllByRole("option")).toHaveLength(3);
  });
});
