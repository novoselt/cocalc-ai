/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

/*
Regression cover for the zoom save callback going stale.

It used to be built by a useMemo keyed only on the frame id while closing over
`disabled` and `onZoom`, so a hook that first mounted while disabled kept a
no-op save forever, and a changed onZoom was never picked up.
*/

import { fireEvent, render } from "@testing-library/react";
import { useRef } from "react";

import usePinchToZoom from "./pinch-to-zoom";

const useFrameContext = jest.fn();

jest.mock("./frame-context", () => ({
  useFrameContext: (...args: any[]) => useFrameContext(...args),
}));

// usePinch attaches gesture listeners we do not exercise here; the native
// ctrl+wheel path is the one under test.
jest.mock("@use-gesture/react", () => ({
  usePinch: () => {},
}));

function Harness({
  disabled,
  onZoom,
}: {
  disabled?: boolean;
  onZoom?: (data: { fontSize: number; first?: boolean }) => void;
}) {
  const target = useRef<any>(null);
  usePinchToZoom({
    target,
    disabled,
    onZoom,
    throttleMs: 0,
    getFontSize: () => 14,
  });
  return <div ref={target} data-testid="target" style={{ height: 100 }} />;
}

function ctrlWheel(el: Element) {
  fireEvent.wheel(el, { deltaY: -100, ctrlKey: true, deltaMode: 0 });
}

describe("usePinchToZoom save callback", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useFrameContext.mockReturnValue({
      actions: { set_font_size: jest.fn() },
      id: "frame-1",
    });
  });

  it("zooms when enabled", () => {
    const onZoom = jest.fn();
    const { getByTestId } = render(<Harness onZoom={onZoom} />);
    ctrlWheel(getByTestId("target"));
    expect(onZoom).toHaveBeenCalled();
  });

  it("does not zoom while disabled", () => {
    const onZoom = jest.fn();
    const { getByTestId } = render(<Harness disabled onZoom={onZoom} />);
    ctrlWheel(getByTestId("target"));
    expect(onZoom).not.toHaveBeenCalled();
  });

  it("zooms after being re-enabled", () => {
    const onZoom = jest.fn();
    const { getByTestId, rerender } = render(
      <Harness disabled onZoom={onZoom} />,
    );
    rerender(<Harness disabled={false} onZoom={onZoom} />);
    ctrlWheel(getByTestId("target"));
    expect(onZoom).toHaveBeenCalled();
  });

  it("uses the latest onZoom after it changes", () => {
    const first = jest.fn();
    const second = jest.fn();
    const { getByTestId, rerender } = render(<Harness onZoom={first} />);
    rerender(<Harness onZoom={second} />);
    ctrlWheel(getByTestId("target"));
    expect(second).toHaveBeenCalled();
    expect(first).not.toHaveBeenCalled();
  });

  it("stops zooming once disabled again", () => {
    const onZoom = jest.fn();
    const { getByTestId, rerender } = render(<Harness onZoom={onZoom} />);
    rerender(<Harness disabled onZoom={onZoom} />);
    ctrlWheel(getByTestId("target"));
    expect(onZoom).not.toHaveBeenCalled();
  });
});
