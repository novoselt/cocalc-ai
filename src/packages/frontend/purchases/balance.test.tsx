/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import Balance from "./balance";

let mockBalance = 1835;

jest.mock("antd", () => ({
  Button: ({ children, loading, onClick }: any) => (
    <button disabled={loading} onClick={onClick} type="button">
      {children}
    </button>
  ),
  Card: ({ children }: any) => <section>{children}</section>,
  Space: ({ children }: any) => <div>{children}</div>,
  Spin: () => <div>Loading</div>,
  Typography: {
    Text: ({ children }: any) => <span>{children}</span>,
  },
}));

jest.mock("@cocalc/frontend/app-framework", () => ({
  useTypedRedux: () => mockBalance,
}));

jest.mock("@cocalc/frontend/components/icon", () => ({
  Icon: () => null,
}));

jest.mock("./auto-balance", () => ({
  __esModule: true,
  default: () => <div>Automatic deposit controls</div>,
}));

jest.mock("./payment", () => ({
  __esModule: true,
  default: () => <div>Add funds form</div>,
}));

describe("Balance", () => {
  beforeEach(() => {
    mockBalance = 1835;
  });

  it("shows the balance, refresh action, and add-funds action together", async () => {
    const refresh = jest.fn();

    render(<Balance refresh={refresh} />);

    expect(screen.getByText("Current balance:")).toBeTruthy();
    expect(screen.getByText("$1,835.00")).toBeTruthy();
    expect(screen.getByText("Automatic deposit controls")).toBeTruthy();

    fireEvent.click(screen.getByText("Refresh"));
    await waitFor(() => expect(refresh).toHaveBeenCalledTimes(1));

    fireEvent.click(screen.getByText("Add funds"));
    expect(screen.getByText("Add funds form")).toBeTruthy();
  });
});
