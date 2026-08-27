/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

import { CustomersAdmin } from "./index";

const getOrganization = jest.fn();
const updatePerson = jest.fn();

jest.mock("@cocalc/frontend/auth/fresh-auth", () => ({
  FreshAuthModal: () => null,
  useFreshAuthAction: () => ({
    runFreshAuthAction: async (action: () => Promise<void>) => {
      await action();
      return true;
    },
    freshAuthModalProps: {},
  }),
}));

jest.mock("@cocalc/frontend/components", () => ({
  ErrorDisplay: ({ error }: { error: unknown }) => (
    <div role="alert">{`${error}`}</div>
  ),
  Icon: ({ name }: { name: string }) => <span aria-hidden="true">{name}</span>,
  TimeAgo: ({ date }: { date: string }) => <span>{date}</span>,
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    browser_id: "browser-crm-test",
    conat_client: {
      hub: {
        adminCrm: {
          getOrganization: (...args: unknown[]) => getOrganization(...args),
          updatePerson: (...args: unknown[]) => updatePerson(...args),
        },
      },
    },
  },
}));

jest.mock("../receivables/account-names", () => ({
  AccountIdentity: () => <span>Account</span>,
  useAccountDisplayNames: () => ({}),
}));

jest.mock("./selector", () => ({
  CustomerSelector: () => <div>Customer selector</div>,
}));

jest.mock("./outreach", () => ({
  CustomerOutreachCard: () => null,
  OutreachAdmin: () => null,
}));

const person = {
  id: "22222222-2222-4222-8222-222222222222",
  display_name: "Ada Example",
  website: "https://ada.example.edu/",
  linkedin_url: "https://linkedin.com/in/ada-example",
  facebook_url: "https://facebook.com/ada.example",
  x_url: "https://x.com/ada_example",
  note: "Primary procurement contact.",
  timezone: "America/New_York",
  status: "active",
  created_by_account_id: "33333333-3333-4333-8333-333333333333",
  updated_by_account_id: "33333333-3333-4333-8333-333333333333",
  created_at: "2026-08-26T00:00:00.000Z",
  updated_at: "2026-08-26T00:00:00.000Z",
  version: 2,
  emails: [
    {
      id: "44444444-4444-4444-8444-444444444444",
      person_id: "22222222-2222-4222-8222-222222222222",
      email_address: "ada@example.edu",
      normalized_email: "ada@example.edu",
      kind: "work",
      is_primary: true,
      verified: true,
      created_at: "2026-08-26T00:00:00.000Z",
      updated_at: "2026-08-26T00:00:00.000Z",
      version: 1,
    },
  ],
  accounts: [],
  organizations: [],
};

const customer = {
  organization: {
    id: "11111111-1111-4111-8111-111111111111",
    customer_number: "CRM-2026-000001",
    display_name: "Example University",
    legal_name: null,
    aliases: [],
    website: null,
    timezone: null,
    organization_type: "university",
    lifecycle_stage: "prospect",
    relationship_owner_account_id: null,
    parent_organization_id: null,
    status: "active",
    merged_into_organization_id: null,
    created_by_account_id: "33333333-3333-4333-8333-333333333333",
    updated_by_account_id: "33333333-3333-4333-8333-333333333333",
    created_at: "2026-08-26T00:00:00.000Z",
    updated_at: "2026-08-26T00:00:00.000Z",
    version: 1,
  },
  parent_organization: null,
  domains: [],
  people: [person],
  relationships: [
    {
      id: "55555555-5555-4555-8555-555555555555",
      organization_id: "11111111-1111-4111-8111-111111111111",
      person_id: person.id,
      roles: ["primary_contact"],
      title: "Procurement Manager",
      department: "Finance",
      state: "active",
      created_at: "2026-08-26T00:00:00.000Z",
      updated_at: "2026-08-26T00:00:00.000Z",
      version: 1,
    },
  ],
  opportunities: [],
  tasks: [],
  activities: [],
  external_references: [],
  metrics: {
    organization_id: "11111111-1111-4111-8111-111111111111",
    generated_at: "2026-08-26T00:00:00.000Z",
    scope: "organization",
    commercial_spend_by_year: {},
    outstanding_receivables: "0",
    commercial_order_count: 0,
    linked_account_count: 0,
    active_site_license_count: 0,
    historical_site_license_count: 0,
    licensed_seats: 0,
    estimated_domain_account_count: 0,
    provenance: {},
  },
  commercial_orders: [],
  site_licenses: [],
};

describe("CRM person profile fields", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getOrganization.mockResolvedValue(customer);
    updatePerson.mockResolvedValue({
      preview: true,
      action: "person.update",
      expected_version: 2,
      idempotency_key: "person-update-preview",
      proposed: {},
      warnings: [],
    });
  });

  it("renders reviewed profiles and exposes an accessible edit form", async () => {
    render(
      <CustomersAdmin
        customerId={customer.organization.id}
        onBack={jest.fn()}
        onOpenCustomer={jest.fn()}
      />,
    );

    expect(await screen.findByText("Ada Example")).toBeVisible();
    expect(screen.getByRole("link", { name: "LinkedIn" })).toHaveAttribute(
      "href",
      person.linkedin_url,
    );
    expect(screen.getByText(person.note)).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Edit Ada Example" }));
    const dialog = await screen.findByRole("dialog", {
      name: "Edit Ada Example",
    });
    expect(within(dialog).getByLabelText(/^Website/)).toHaveValue(
      person.website,
    );
    expect(within(dialog).getByLabelText(/^LinkedIn/)).toHaveValue(
      person.linkedin_url,
    );
    expect(within(dialog).getByLabelText(/^Internal note/)).toHaveValue(
      person.note,
    );

    fireEvent.change(within(dialog).getByLabelText(/^Internal note/), {
      target: { value: "Coordinates procurement and pilot onboarding." },
    });
    fireEvent.change(within(dialog).getByLabelText("Audit reason"), {
      target: { value: "Reviewed current contact details" },
    });
    fireEvent.click(
      within(dialog).getByRole("button", { name: "Review change" }),
    );

    await waitFor(() => expect(updatePerson).toHaveBeenCalledTimes(1));
    expect(updatePerson).toHaveBeenCalledWith(
      expect.objectContaining({
        person: person.id,
        commit: false,
        changes: expect.objectContaining({
          website: person.website,
          linkedin_url: person.linkedin_url,
          facebook_url: person.facebook_url,
          x_url: person.x_url,
          note: "Coordinates procurement and pilot onboarding.",
        }),
      }),
    );
  });
});
