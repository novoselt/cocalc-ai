/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";

import { AddPage } from "./new-page";

const actions = {
  mainFrameType: "slides",
  newPage: jest.fn(() => "new-page"),
  setPageId: jest.fn(),
  show_focused_frame_of_type: jest.fn(() => "main-frame"),
};

jest.mock("./hooks", () => ({
  useFrameContext: () => ({ actions }),
}));

describe("AddPage", () => {
  it("is named and does not select the parent page when activated", () => {
    const selectPage = jest.fn();
    render(
      <div onClick={selectPage}>
        <AddPage pageId="page-1" />
      </div>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Insert new page" }));

    expect(selectPage).not.toHaveBeenCalled();
    expect(actions.newPage).toHaveBeenCalledWith("main-frame", "page-1");
  });
});
