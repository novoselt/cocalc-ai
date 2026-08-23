import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { ReceivableOrderCreate } from "./create";
import {
  commercialOrderInitialValues,
  prepareCommercialOrder,
} from "./order-form";

const createOrder = jest.fn();
const listSiteLicenseOverviews = jest.fn();
const listAssignees = jest.fn();
const userSearch = jest.fn();
const getNames = jest.fn();
const mockRunFreshAuthAction = jest.fn(async (action: () => Promise<void>) => {
  await action();
  return true;
});

jest.mock("@cocalc/frontend/auth/fresh-auth", () => ({
  FreshAuthModal: () => <div data-testid="fresh-auth-modal" />,
  useFreshAuthAction: () => ({
    runFreshAuthAction: mockRunFreshAuthAction,
    freshAuthModalProps: {},
  }),
}));

jest.mock("@cocalc/frontend/components", () => ({
  Icon: ({ name }: { name: string }) => <span>{name}</span>,
}));

jest.mock("@cocalc/frontend/purchases/api", () => ({
  listSiteLicenseOverviews: (...args: unknown[]) =>
    listSiteLicenseOverviews(...args),
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    browser_id: "browser-test-1",
    users_client: {
      getNames: (...args: unknown[]) => getNames(...args),
      user_search: (...args: unknown[]) => userSearch(...args),
    },
    conat_client: {
      hub: {
        commercialOrders: {
          create: (...args: unknown[]) => createOrder(...args),
          listAssignees: (...args: unknown[]) => listAssignees(...args),
        },
      },
    },
  },
}));

describe("commercial order creation", () => {
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
    createOrder.mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      order_number: "AR-2026-000123",
    });
    listSiteLicenseOverviews.mockResolvedValue([]);
    listAssignees.mockResolvedValue([]);
    userSearch.mockResolvedValue([]);
    getNames.mockResolvedValue({});
  });

  it("builds the complete reviewed site-license request", () => {
    const values = commercialOrderInitialValues();
    Object.assign(values, {
      organization_name: "Example University",
      customer_account_id: "11111111-1111-4111-8111-111111111111",
      zendesk_ticket_ids: "20529, 20102",
      agreed_subtotal: "3900.00",
      agreed_total: "3900.00",
      service_starts_at: "2026-08-23",
      service_ends_at: "2027-06-30",
      next_action: "Send invoice",
      next_action_due_at: "2026-08-25T12:00",
      include_site_license_plan: true,
      site_license_name: "Example University adoption pilot",
      site_license_owner_account_id: "22222222-2222-4222-8222-222222222222",
      site_license_manager_account_ids: "33333333-3333-4333-8333-333333333333",
      site_license_allowed_domains: "example.edu",
      site_license_starts_at: "2026-08-23",
      site_license_expires_at: "2027-06-30",
      reason: "Reviewed offer in Zendesk ticket 20529",
    });
    values.items[0].unit_amount = "3900.00";
    values.items[0].subtotal = "3900.00";
    values.contacts[0].name_snapshot = "Billing Contact";
    values.contacts[0].email_snapshot = "billing@example.edu";
    values.pools[0].seat_limit = 5000;

    const prepared = prepareCommercialOrder(values);

    expect(prepared.currency).toBe("usd");
    expect(prepared.zendesk_ticket_ids).toEqual([20529, 20102]);
    expect(prepared.items).toEqual([
      expect.objectContaining({
        description: "Campus adoption pilot",
        subtotal: "3900.00",
      }),
    ]);
    expect(prepared.contacts).toEqual([
      expect.objectContaining({
        role: "billing",
        email_snapshot: "billing@example.edu",
      }),
    ]);
    expect(prepared.terms_snapshot.site_license).toEqual(
      expect.objectContaining({
        allowed_domains: ["example.edu"],
        manager_account_ids: ["33333333-3333-4333-8333-333333333333"],
        pools: expect.arrayContaining([
          expect.objectContaining({
            membership_class: "student",
            seat_limit: 5000,
          }),
        ]),
      }),
    );
  });

  it("previews and fresh-authenticates an explicit order submission", async () => {
    const onCreated = jest.fn();
    render(<ReceivableOrderCreate onBack={jest.fn()} onCreated={onCreated} />);

    fireEvent.change(
      screen.getByRole("textbox", { name: "Organization name" }),
      {
        target: { value: "Example University" },
      },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Agreed subtotal (USD)" }),
      { target: { value: "3900.00" } },
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Agreed total (USD)" }),
      { target: { value: "3900.00" } },
    );
    fireEvent.mouseDown(screen.getByRole("combobox", { name: "Next action" }));
    fireEvent.click(await screen.findByText("Send invoice"));
    fireEvent.change(
      screen.getByRole("textbox", { name: "Unit amount (USD)" }),
      { target: { value: "3900.00" } },
    );
    fireEvent.change(screen.getByRole("textbox", { name: "Subtotal (USD)" }), {
      target: { value: "3900.00" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Name" }), {
      target: { value: "Billing Contact" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Email" }), {
      target: { value: "billing@example.edu" },
    });
    fireEvent.change(screen.getByRole("textbox", { name: "Audit reason" }), {
      target: { value: "Reviewed offer and billing recipient" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Review new order" }));

    let title: HTMLElement | null = null;
    await waitFor(() => {
      title = document.getElementById("receivables-create-review-title");
      expect(title).toHaveFocus();
    });
    const dialog = title?.closest('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(
      within(dialog!).getByText("Review new commercial order"),
    ).toBeVisible();
    expect(within(dialog!).getByText("Example University")).toBeVisible();
    expect(
      within(dialog!).getByText(/Billing Contact <billing@example\.edu>/),
    ).toBeVisible();

    fireEvent.click(
      within(dialog!).getByRole("button", {
        name: "Create order (fresh authentication required)",
      }),
    );

    await waitFor(() => expect(createOrder).toHaveBeenCalledTimes(1));
    expect(mockRunFreshAuthAction).toHaveBeenCalledTimes(1);
    expect(createOrder).toHaveBeenCalledWith(
      expect.objectContaining({
        browser_id: "browser-test-1",
        organization_name: "Example University",
        agreed_total: "3900.00",
        reason: "Reviewed offer and billing recipient",
        source: "admin-ui",
        currency: "usd",
      }),
    );
    expect(onCreated).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
    );
  }, 15_000);

  it("reveals explicitly labeled site-license plan controls", async () => {
    render(<ReceivableOrderCreate onBack={jest.fn()} onCreated={jest.fn()} />);

    fireEvent.click(
      screen.getByRole("checkbox", {
        name: "Include an approved site-license plan",
      }),
    );

    expect(await screen.findByLabelText("Site license name")).toBeVisible();
    expect(screen.getByLabelText("Owner account ID")).toBeVisible();
    expect(screen.getByLabelText("Allowed email domains")).toBeVisible();
    expect(screen.getAllByLabelText("Membership class")).toHaveLength(2);
    expect(screen.getAllByLabelText("Seat limit")).toHaveLength(2);
  });
});
