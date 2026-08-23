import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { message } from "antd";

import type { CommercialOrderDiagnostics } from "@cocalc/util/commercial-orders";
import { ReceivablesQueue } from "./queue";

const listOrders = jest.fn();
const getDiagnostics = jest.fn();
const retryStripeEvent = jest.fn();
const getNames = jest.fn();
const listAssignees = jest.fn();
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
  TimeAgo: ({ date }: { date: string }) => <span>{date}</span>,
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    users_client: {
      getNames: (...args: unknown[]) => getNames(...args),
      user_search: jest.fn(async () => []),
    },
    conat_client: {
      hub: {
        commercialOrders: {
          list: (...args: unknown[]) => listOrders(...args),
          diagnostics: (...args: unknown[]) => getDiagnostics(...args),
          retryStripeEvent: (...args: unknown[]) => retryStripeEvent(...args),
          listAssignees: (...args: unknown[]) => listAssignees(...args),
        },
      },
    },
  },
}));

const diagnostics: CommercialOrderDiagnostics = {
  generated_at: "2026-08-23T12:00:00.000Z",
  counts: { open_orders: 1, stripe_dead_letter: 1 },
  amounts: { open_amount: "3900.00" },
  reconciliation: {
    provider_local_mismatch_count: 0,
    oldest_reconciliation_lag_seconds: 30,
  },
  stale_invoice_ids: [],
  inconsistent_order_ids: [],
  review_queues: {
    truncated: {},
    active_commercial_site_license_ids: [],
    unlinked_commercial_stripe_invoices: [],
    failed_stripe_events: [
      {
        event_id: "evt_deadletter1",
        event_type: "invoice.updated",
        status: "dead_letter",
        commercial_order_id: "11111111-1111-4111-8111-111111111111",
        attempt_count: 8,
        next_attempt_at: "2026-08-23T12:00:00.000Z",
        last_error: "review required",
        created_at: "2026-08-23T10:00:00.000Z",
        updated_at: "2026-08-23T12:00:00.000Z",
      },
    ],
    indeterminate_provider_operations: [],
    failed_stripe_event_ids: ["evt_deadletter1"],
    indeterminate_provider_operation_ids: [],
    open_orders_missing_due_date_ids: [],
  },
};

describe("receivables queue", () => {
  beforeAll(() => {
    const getComputedStyle = window.getComputedStyle;
    jest
      .spyOn(window, "getComputedStyle")
      .mockImplementation((element) => getComputedStyle(element));
    jest.spyOn(message, "success").mockImplementation(() => undefined as any);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    listOrders.mockResolvedValue({
      orders: [],
      truncated: false,
      result_bytes: 0,
    });
    getDiagnostics.mockResolvedValue(diagnostics);
    retryStripeEvent.mockResolvedValue({
      event_id: "evt_deadletter1",
      status: "pending",
      commercial_order_id: "11111111-1111-4111-8111-111111111111",
    });
    getNames.mockResolvedValue({});
    listAssignees.mockResolvedValue([]);
  });

  it("requires reviewed fresh authentication before retrying a dead-letter event", async () => {
    render(
      <ReceivablesQueue onCreateOrder={jest.fn()} onOpenOrder={jest.fn()} />,
    );

    await waitFor(() => expect(getDiagnostics).toHaveBeenCalledTimes(1));
    fireEvent.click(await screen.findByText("Operational diagnostics"));
    fireEvent.click(
      await screen.findByRole("button", {
        name: "Review evt_deadletter1",
      }),
    );

    const retry = screen.getByRole("button", {
      name: "Retry after fresh authentication",
    });
    expect(retry).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Stripe event retry audit reason"), {
      target: { value: "Verified the corrected Stripe invoice identity" },
    });
    fireEvent.click(
      screen.getByText(
        "I reviewed the failure, order, invoice, and provider state.",
      ),
    );
    expect(retry).toBeEnabled();
    fireEvent.click(retry);

    await waitFor(() => expect(retryStripeEvent).toHaveBeenCalledTimes(1));
    expect(mockRunFreshAuthAction).toHaveBeenCalledWith(expect.any(Function));
    expect(retryStripeEvent).toHaveBeenCalledWith({
      event_id: "evt_deadletter1",
      reason: "Verified the corrected Stripe invoice identity",
      source: "admin-ui",
      idempotency_key: "admin-ui:stripe-event-retry:evt_deadletter1:attempt-8",
    });
  });

  it("renders a resolved assignee and a compact order action", async () => {
    const assignee = "8a52c640-079f-496d-85cb-0147bdf9fd6d";
    listOrders.mockResolvedValue({
      orders: [
        {
          id: "fb520d40-fa12-4c0e-b55b-fec04d1a99f8",
          order_number: "AR-2026-FB520D40",
          organization_name: "Example University",
          zendesk_ticket_ids: [20573],
          workflow_state: "awaiting_payment",
          collection_mode: "stripe_invoice",
          collection_state: "open",
          fulfillment_state: "provisioned",
          currency: "usd",
          agreed_subtotal: "750.0000000000",
          agreed_total: "750.0000000000",
          assignee_account_id: assignee,
          next_action: "Collect payment",
          created_by_account_id: assignee,
          created_at: "2026-08-23T00:00:00.000Z",
          updated_at: "2026-08-23T00:00:00.000Z",
          last_activity_at: "2026-08-23T00:00:00.000Z",
          version: 4,
        },
      ],
      truncated: false,
      result_bytes: 100,
    });
    getNames.mockResolvedValue({
      [assignee]: {
        display_name: "William Stein",
        first_name: "William",
        last_name: "Stein",
      },
    });
    const openOrder = jest.fn();

    render(
      <ReceivablesQueue onCreateOrder={jest.fn()} onOpenOrder={openOrder} />,
    );

    await waitFor(() =>
      expect(screen.getByTitle(assignee)).toHaveTextContent("William Stein"),
    );
    expect(
      screen.getByRole("link", { name: /Zendesk ticket 20573 \(external\)/ }),
    ).toBeVisible();
    const open = screen.getByRole("button", { name: "Open AR-2026-FB520D40" });
    expect(open).toHaveTextContent("Open");
    expect(open).not.toHaveTextContent("AR-2026-FB520D40");
    fireEvent.click(open);
    expect(openOrder).toHaveBeenCalledWith(
      "fb520d40-fa12-4c0e-b55b-fec04d1a99f8",
    );
  });
});
