/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";

import DeletePage from "./delete-page";

const deletePage = jest.fn();

jest.mock("@cocalc/frontend/components", () => ({
  Tooltip: ({ children }: any) => <>{children}</>,
}));

jest.mock("./hooks", () => ({
  useFrameContext: () => ({ actions: { deletePage } }),
}));

describe("DeletePage", () => {
  it("opens its confirmation and deletes only after confirmation", async () => {
    render(<DeletePage pageId="page-1" />);

    fireEvent.click(screen.getByRole("button", { name: "Delete this page" }));

    expect(deletePage).not.toHaveBeenCalled();
    const confirmation = await screen.findByText("Delete this page?");
    expect(confirmation.closest(".ant-popover")).not.toHaveClass(
      "ant-popover-hidden",
    );

    fireEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(deletePage).toHaveBeenCalledWith("page-1");
  });
});
