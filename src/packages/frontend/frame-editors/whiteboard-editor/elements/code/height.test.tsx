/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Height-sync behaviour for whiteboard Jupyter cells.

The regression these cover: the outer div is floored at element.h (it carries
minHeight/height 100% against the fixed-height parent from position.tsx), so
measuring shrink from outer.scrollHeight can never report a smaller box and the
shrink path is unreachable. Shrink must be measured from the inner div.
*/

import { act, render } from "@testing-library/react";

import Code from "./index";

const useFrameContext = jest.fn();
const setElement = jest.fn();

jest.mock("../../hooks", () => ({
  useFrameContext: (...args: any[]) => useFrameContext(...args),
}));

jest.mock("./actions", () => ({
  getMode: async () => "python",
}));

jest.mock("@cocalc/frontend/app-framework/is-mounted-hook", () => ({
  __esModule: true,
  default: () => ({ current: true }),
}));

jest.mock("@cocalc/frontend/file-extensions", () => ({
  codemirrorMode: () => "python",
}));

jest.mock("../edit-focus", () => ({
  __esModule: true,
  default: () => [false, jest.fn()],
}));

jest.mock("./control", () => () => null);
jest.mock("./input", () => () => <div data-testid="code-input" />);
jest.mock("./input-prompt", () => () => null);
jest.mock("./output", () => () => null);
jest.mock("./input-static", () => ({
  __esModule: true,
  default: () => <div data-testid="static" />,
}));
jest.mock("./style", () => ({
  __esModule: true,
  default: () => ({}),
}));

let observerCallbacks: (() => void)[] = [];

class FakeResizeObserver {
  constructor(cb: () => void) {
    observerCallbacks.push(cb);
  }
  observe() {}
  disconnect() {}
  unobserve() {}
}

function setScrollHeight(el: Element, value: number) {
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => value,
  });
}

/* Render a cell and return handles to the outer and inner divs.
   `outer` is what the component floors at element.h; `inner` tracks content. */
function renderCell({
  h,
  outerScrollHeight,
  innerScrollHeight,
}: {
  h: number;
  outerScrollHeight: number;
  innerScrollHeight: number;
}) {
  useFrameContext.mockReturnValue({
    actions: { in_undo_mode: () => false, setElement },
    project_id: "project-1",
    path: "/a.board",
  });

  const { container } = render(
    <Code
      element={{ id: "e1", data: {}, h, str: "" } as any}
      canvasScale={1}
      focused={false}
    />,
  );

  const outer = container.firstElementChild as HTMLElement;
  const inner = outer.firstElementChild as HTMLElement;
  setScrollHeight(outer, outerScrollHeight);
  setScrollHeight(inner, innerScrollHeight);
  return { outer, inner };
}

describe("whiteboard Jupyter cell height sync", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    observerCallbacks = [];
    setElement.mockClear();
    (global as any).ResizeObserver = FakeResizeObserver;
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("shrinks an unfocused cell when its content gets smaller", () => {
    // Content is 100 tall, but the saved height is 200 and the outer div is
    // floored there. Measuring outer would report 200 and never shrink.
    renderCell({ h: 200, outerScrollHeight: 200, innerScrollHeight: 100 });

    act(() => {
      observerCallbacks.forEach((cb) => cb());
      // shrink is debounced by 250ms
      jest.advanceTimersByTime(300);
    });

    expect(setElement).toHaveBeenCalledWith(
      expect.objectContaining({
        obj: expect.objectContaining({ id: "e1", h: 100 }),
      }),
    );
  });

  it("commits the shrink so collaborators see it", () => {
    renderCell({ h: 200, outerScrollHeight: 200, innerScrollHeight: 100 });

    act(() => {
      observerCallbacks.forEach((cb) => cb());
      jest.advanceTimersByTime(300);
    });

    const call = setElement.mock.calls.find((c) => c[0]?.obj?.h === 100);
    expect(call?.[0].commit).toBe(true);
  });

  it("does not shrink for a sub-threshold difference", () => {
    // 199 vs 200 is within the 2px deadband and must not churn the document.
    renderCell({ h: 200, outerScrollHeight: 200, innerScrollHeight: 199 });

    act(() => {
      observerCallbacks.forEach((cb) => cb());
      jest.advanceTimersByTime(300);
    });

    expect(setElement).not.toHaveBeenCalled();
  });

  it("does not grow for a sub-threshold difference", () => {
    // A constant sub-threshold overshoot is what previously fed back through
    // the observer and grew the cell without bound.
    renderCell({ h: 200, outerScrollHeight: 202, innerScrollHeight: 202 });

    act(() => {
      observerCallbacks.forEach((cb) => cb());
      jest.advanceTimersByTime(300);
    });

    expect(setElement).not.toHaveBeenCalled();
  });

  it("grows immediately when content genuinely exceeds the saved height", () => {
    renderCell({ h: 200, outerScrollHeight: 320, innerScrollHeight: 320 });

    act(() => {
      observerCallbacks.forEach((cb) => cb());
    });

    expect(setElement).toHaveBeenCalledWith(
      expect.objectContaining({
        obj: expect.objectContaining({ id: "e1", h: 320 }),
      }),
    );
  });

  it("never reports a height below the minimum", () => {
    renderCell({ h: 200, outerScrollHeight: 200, innerScrollHeight: 4 });

    act(() => {
      observerCallbacks.forEach((cb) => cb());
      jest.advanceTimersByTime(300);
    });

    const call = setElement.mock.calls.find((c) => c[0]?.obj?.h != null);
    expect(call?.[0].obj.h).toBe(78);
  });
});
