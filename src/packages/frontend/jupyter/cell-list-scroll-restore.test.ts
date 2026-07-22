/** @jest-environment jsdom */

import { canShowCellDragHandle, restoreNotebookScroll } from "./cell-list";

function makeScroller({
  scrollTop,
  getScrollHeight,
}: {
  scrollTop: number;
  getScrollHeight: () => number;
}): HTMLElement {
  const element = document.createElement("div");
  element.scrollTop = scrollTop;
  Object.defineProperty(element, "scrollHeight", {
    configurable: true,
    get: getScrollHeight,
  });
  return element;
}

describe("restoreNotebookScroll", () => {
  it("keeps restoring while rendering changes scroll height", async () => {
    let scrollHeight = 100;
    const scroller = makeScroller({
      scrollTop: 0,
      getScrollHeight: () => scrollHeight,
    });
    const waits: number[] = [];

    await restoreNotebookScroll({
      scrollTop: 25,
      getElement: () => scroller,
      isMounted: () => true,
      wait: async (ms) => {
        waits.push(ms);
        scrollHeight += 100;
      },
    });

    expect(scroller.scrollTop).toBe(25);
    expect(waits).toEqual([0, 1, 100, 250, 500, 1000]);
  });

  it("stops restoring when the user scrolls away from the saved position", async () => {
    let cancelled = false;
    let scrollHeight = 100;
    const scroller = makeScroller({
      scrollTop: 0,
      getScrollHeight: () => scrollHeight,
    });

    await restoreNotebookScroll({
      scrollTop: 25,
      getElement: () => scroller,
      isMounted: () => true,
      shouldCancel: () => cancelled,
      wait: async (ms) => {
        if (ms !== 0) return;
        scrollHeight = 300;
        scroller.scrollTop = 180;
        cancelled = true;
      },
    });

    expect(scroller.scrollTop).toBe(180);
  });
});

describe("canShowCellDragHandle", () => {
  it("fails closed while notebook actions have no store", () => {
    expect(canShowCellDragHandle({} as any, "cell-1")).toBe(false);
  });

  it("uses the notebook store's editability decision", () => {
    const is_cell_editable = jest.fn(() => true);
    const actions = { store: { is_cell_editable } } as any;

    expect(canShowCellDragHandle(actions, "cell-1")).toBe(true);
    expect(is_cell_editable).toHaveBeenCalledWith("cell-1");
  });
});
