import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { AccountSelector } from "./account-selector";

const listAssignees = jest.fn();
const userSearch = jest.fn();

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    users_client: {
      user_search: (...args: unknown[]) => userSearch(...args),
    },
    conat_client: {
      hub: {
        commercialOrders: {
          listAssignees: (...args: unknown[]) => listAssignees(...args),
        },
      },
    },
  },
}));

describe("receivables account selector", () => {
  beforeAll(() => {
    const getComputedStyle = window.getComputedStyle;
    jest
      .spyOn(window, "getComputedStyle")
      .mockImplementation((element) => getComputedStyle(element));
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    listAssignees.mockResolvedValue([]);
    userSearch.mockResolvedValue([]);
  });

  it("lists eligible admins by name instead of exposing raw IDs", async () => {
    const onChange = jest.fn();
    listAssignees.mockResolvedValue([
      {
        account_id: "8a52c640-079f-496d-85cb-0147bdf9fd6d",
        display_name: "William Stein",
        email_address: "wstein@sagemath.com",
        is_admin: true,
      },
    ]);
    render(<AccountSelector accountKind="admin" onChange={onChange} />);

    await waitFor(() => expect(listAssignees).toHaveBeenCalledTimes(1));
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Assignee" }));
    fireEvent.click(await screen.findByText("William Stein"));

    expect(onChange).toHaveBeenCalledWith(
      "8a52c640-079f-496d-85cb-0147bdf9fd6d",
      expect.anything(),
    );
  });

  it("uses the caller's relationship-owner label", async () => {
    render(
      <AccountSelector accountKind="admin" ariaLabel="Relationship owner" />,
    );

    expect(
      screen.getByRole("combobox", { name: "Relationship owner" }),
    ).toBeVisible();
    await waitFor(() => expect(listAssignees).toHaveBeenCalledTimes(1));
  });

  it("searches all accounts for the customer selector", async () => {
    const onChange = jest.fn();
    userSearch.mockResolvedValue([
      {
        account_id: "11111111-1111-4111-8111-111111111111",
        display_name: "Customer Person",
        email_address: "customer@example.edu",
      },
    ]);
    render(<AccountSelector accountKind="customer" onChange={onChange} />);

    fireEvent.change(
      screen.getByRole("combobox", { name: "Customer CoCalc account" }),
      { target: { value: "customer@example.edu" } },
    );
    await waitFor(() =>
      expect(userSearch).toHaveBeenCalledWith({
        query: "customer@example.edu",
        admin: true,
        limit: 20,
      }),
    );
    fireEvent.click(await screen.findByText("Customer Person"));

    expect(onChange).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.anything(),
    );
  });
});
