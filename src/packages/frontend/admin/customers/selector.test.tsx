import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { CustomerSelector, PersonSelector } from "./selector";

const searchOrganizations = jest.fn();
const searchPeople = jest.fn();

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    conat_client: {
      hub: {
        adminCrm: {
          searchOrganizations: (...args: unknown[]) =>
            searchOrganizations(...args),
          searchPeople: (...args: unknown[]) => searchPeople(...args),
        },
      },
    },
  },
}));

describe("CRM customer selector", () => {
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
    searchOrganizations.mockResolvedValue({ organizations: [] });
    searchPeople.mockResolvedValue({ people: [] });
  });

  it("searches by accessible name and renders human customer identity", async () => {
    const onChange = jest.fn();
    searchOrganizations.mockResolvedValue({
      organizations: [
        {
          id: "11111111-1111-4111-8111-111111111111",
          display_name: "Example University",
          customer_number: "CRM-2026-000123",
        },
      ],
    });
    render(<CustomerSelector onChange={onChange} />);

    fireEvent.change(
      screen.getByRole("combobox", { name: "Customer organization" }),
      { target: { value: "example.edu" } },
    );
    await waitFor(() =>
      expect(searchOrganizations).toHaveBeenCalledWith({
        query: "example.edu",
        reason: "Search CRM customer selector",
        limit: 20,
      }),
    );
    fireEvent.click(
      await screen.findByText("Example University · CRM-2026-000123"),
    );

    expect(onChange).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.anything(),
    );
    expect(
      screen.getByRole("option", {
        name: "Example University · CRM-2026-000123",
      }),
    ).toBeInTheDocument();
  });

  it("selects a reviewed contact by name and primary email", async () => {
    const onChange = jest.fn();
    const onSelectPerson = jest.fn();
    const person = {
      id: "22222222-2222-4222-8222-222222222222",
      display_name: "Ada Procurement",
      emails: [
        {
          email_address: "ada@example.edu",
          is_primary: true,
        },
      ],
      accounts: [],
      organizations: [],
    };
    searchPeople.mockResolvedValue({ people: [person] });
    render(
      <PersonSelector
        onChange={onChange}
        onSelectPerson={onSelectPerson}
        organization="CRM-2026-000123"
      />,
    );

    fireEvent.change(screen.getByRole("combobox", { name: "CRM contact" }), {
      target: { value: "ada" },
    });
    await waitFor(() =>
      expect(searchPeople).toHaveBeenCalledWith({
        organization: "CRM-2026-000123",
        search: "ada",
        reason: "Search CRM contact selector",
        limit: 20,
      }),
    );
    fireEvent.click(
      await screen.findByText("Ada Procurement · ada@example.edu"),
    );

    expect(onChange).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(onSelectPerson).toHaveBeenCalledWith(person);
  });
});
