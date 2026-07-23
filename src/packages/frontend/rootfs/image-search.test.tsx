/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { act, fireEvent, render, screen } from "@testing-library/react";

import RootfsImageSearch from "./image-search";

describe("RootfsImageSearch", () => {
  it("keeps focus while filtered images are loading", () => {
    const onChange = jest.fn();
    const { rerender } = render(
      <RootfsImageSearch loading={false} onChange={onChange} value="" />,
    );
    const input = screen.getByRole("searchbox");
    act(() => input.focus());
    fireEvent.change(input, { target: { value: "python" } });
    expect(onChange).toHaveBeenCalledWith("python");

    rerender(<RootfsImageSearch loading onChange={onChange} value="python" />);

    expect(input).not.toBeDisabled();
    expect(document.activeElement).toBe(input);
  });
});
