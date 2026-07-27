/** @jest-environment jsdom */

import useIndicator from "@rc-component/tabs/lib/hooks/useIndicator";
import { renderHook } from "@testing-library/react";

describe("Ant Design tab indicator", () => {
  it("derives changing indicator geometry without scheduling state updates", () => {
    const initialProps = {
      activeTabOffset: {
        width: 100,
        height: 32,
        left: 20,
        right: 120,
        top: 0,
      },
      horizontal: true,
      rtl: false,
    };
    const { result, rerender } = renderHook(useIndicator, { initialProps });

    expect(result.current.style).toEqual({
      width: 100,
      left: 70,
      transform: "translateX(-50%)",
    });

    for (let i = 0; i < 100; i += 1) {
      const width = i % 2 === 0 ? 101 : 99;
      rerender({
        ...initialProps,
        activeTabOffset: {
          ...initialProps.activeTabOffset,
          width,
          right: initialProps.activeTabOffset.left + width,
        },
      });
    }

    expect(result.current.style).toEqual({
      width: 99,
      left: 69.5,
      transform: "translateX(-50%)",
    });
  });
});
