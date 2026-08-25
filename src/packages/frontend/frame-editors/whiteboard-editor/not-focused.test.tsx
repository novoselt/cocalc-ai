/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Snap-guide lifecycle for unfocused (select-mode) dragging.

Two regressions are covered here:
  - a drag that ends back at the exact starting position took the "treat as
    click" branch and never cleared the guides;
  - clearing the guides before computeSnapForDrag ran meant the final
    computation put them straight back, so a normal snapped drop left them
    on screen.
*/

import { render } from "@testing-library/react";

import NotFocused from "./not-focused";

const setSnapLines = jest.fn();
const moveElements = jest.fn();

// Capture the props Draggable is given so the test can invoke its callbacks
// directly; jsdom cannot produce a real drag gesture.
let draggableProps: any = {};
jest.mock("react-draggable", () => ({
  __esModule: true,
  default: (props: any) => {
    draggableProps = props;
    return <div data-testid="draggable">{props.children}</div>;
  },
}));

jest.mock("./tools/tool-panel", () => ({
  getElement: () => ({}),
}));

const element = { id: "e1", x: 0, y: 0, w: 100, h: 50, z: 0, type: "text" };

// The component's click path reads e.target.className, so a bare object is
// not enough of a mouse event.
const evt = () =>
  ({
    shiftKey: false,
    target: { className: "" },
    stopPropagation: () => {},
    preventDefault: () => {},
  }) as any;

function mount({ snapEnabled = true }: { snapEnabled?: boolean } = {}) {
  jest.clearAllMocks();
  draggableProps = {};
  return render(
    <NotFocused
      element={element as any}
      focusedEltIds={{}}
      canvasScale={1}
      transforms={{ dataToWindowNoScale: () => ({ x: 0, y: 0, z: 0 }) } as any}
      frame={{ actions: { moveElements }, id: "frame-1" } as any}
      readOnly={false}
      allElements={[element] as any}
      setSnapLines={setSnapLines}
      snapEnabled={snapEnabled}
      selectable
    >
      <div>content</div>
    </NotFocused>,
  );
}

function lastSnapLinesCall() {
  const calls = setSnapLines.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : undefined;
}

describe("NotFocused snap guide lifecycle", () => {
  it("leaves no guides after a normal drop", () => {
    mount();
    draggableProps.onStart?.(evt());
    draggableProps.onDrag?.(evt(), { x: 40, y: 0 });
    draggableProps.onStop?.(evt(), { x: 40, y: 0 });
    // The clear must be the final word: computeSnapForDrag runs inside onStop
    // and would otherwise reinstate the guides for the drop position.
    expect(lastSnapLinesCall()).toEqual([]);
  });

  it("still moves the element on a normal drop", () => {
    mount();
    draggableProps.onStart?.(evt());
    draggableProps.onStop?.(evt(), { x: 40, y: 12 });
    expect(moveElements).toHaveBeenCalled();
  });

  it("leaves no guides when the drag returns to its starting position", () => {
    mount();
    draggableProps.onStart?.(evt());
    draggableProps.onDrag?.(evt(), { x: 30, y: 0 });
    // Back to exactly (0,0): this takes the "treat as click" branch, which
    // does not move the element -- and previously never cleared the guides.
    draggableProps.onStop?.(evt(), { x: 0, y: 0 });
    expect(moveElements).not.toHaveBeenCalled();
    expect(lastSnapLinesCall()).toEqual([]);
  });

  it("clears guides on unmount", () => {
    const { unmount } = mount();
    setSnapLines.mockClear();
    unmount();
    expect(setSnapLines).toHaveBeenCalledWith([]);
  });
});
