# Accounts Receivable Workflow Implementation Plan

Date: 2026-08-22

Status: proposed implementation plan.

## Executive Decision

CoCalc needs a first-class, seed-global accounts receivable workflow for
sales-assisted purchases such as university adoption pilots, site licenses,
custom membership packages, and other negotiated agreements.

The workflow must be the shared operational source of truth for every admin,
support employee, and authorized agent. Stripe remains the payment and invoice
delivery rail. Zendesk remains the customer communication channel. Neither
Stripe nor Zendesk is the authoritative record of the commercial agreement,
its owner, its next action, or its fulfillment state.

The system must explicitly separate:

- what the customer agreed to buy;
- whether and how the customer was invoiced;
- whether payment was received;
- whether CoCalc provisioned the promised service;
- who inside CoCalc owns the next action.

This separation is essential because universities are often provisioned before
payment and may pay weeks or months later through procurement. An active site
license does not imply payment, and a paid invoice does not imply fulfillment.

## Problem

The current sales-assisted payment process depends on private operational
memory. One employee maintains a list and follows up over time. When that
employee is unavailable, accepted offers can be provisioned without a visible
collection process, and other support employees cannot reliably answer:

- What did the customer accept?
- How much do they owe?
- Who is the billing contact?
- Has an invoice been prepared or sent?
- Is a purchase order required?
- Is the invoice overdue?
- Was the site license already provisioned?
- Who is responsible for the next action, and when is it due?

The existing systems each hold only one part of the answer:

- Zendesk holds customer correspondence but is not a financial workflow.
- CRM tasks and leads are generic and do not enforce commercial invariants.
- Stripe knows invoices and payments but not the complete CoCalc agreement or
  fulfillment state.
- `purchases` is the account balance and product ledger, not a pre-payment
  receivables queue.
- `site_licenses` records entitlement and policy, not collection.
- The deprecated `server/purchases/create-invoice.ts` creates generic account
  credit when an invoice is paid and is therefore wrong for an already
  provisioned institutional license.

Using an admin purchase after asking the customer to add a card does not solve
this problem. It skips the period between agreement and payment, exactly where
the operational failure occurs.

## Goals

- Give all authorized admins and agents one complete list of pending
  sales-assisted payments.
- Make ownership and the next action explicit for every open commercial order.
- Provide equivalent admin web and CLI workflows backed by the same RPC API.
- Create, review, finalize, send, void, and reconcile Stripe invoices safely.
- Support card, ACH or bank transfer through Stripe, purchase orders, checks,
  and explicitly recorded manual settlements.
- Allow fulfillment before payment without misrepresenting collection state.
- Link commercial orders to organizations, contacts, Zendesk tickets, CoCalc
  accounts, site licenses, and other fulfilled products.
- Preserve a complete immutable audit trail.
- Make retries and webhook replay idempotent.
- Keep the design correct in one-bay Launchpad and multibay Rocket.
- Make the first release useful before all invoice automation is complete.

## Non-Goals

- Rebuild a general-purpose CRM.
- Replace Stripe as the invoice document and payment processor.
- Replace bookkeeping or tax accounting software.
- Automatically suspend university licenses when an invoice becomes overdue.
- Automatically send customer-facing dunning messages in the first release.
- Convert every historical Stripe invoice or purchase into a commercial order.
- Store card or bank credentials in CoCalc.
- Treat `purchases` as the source of truth for institutional receivables.

## Existing Primitives

The implementation should reuse these existing components where their
semantics match:

- `src/packages/util/db-schema/crm.ts`
  - `crm_organizations`, `crm_people`, `crm_support_tickets`, and `crm_tasks`
    provide useful links and display primitives.
- `src/packages/util/db-schema/site-licenses.ts`
  - site licenses are already seed-global and have a canonical owner account.
- `src/packages/server/membership/site-licenses.ts`
  - existing site-license provisioning and management operations should become
    the first fulfillment adapter.
- `src/packages/util/db-schema/purchases.ts`
  - purchases remain the user-facing account/product ledger where applicable.
- `src/packages/server/purchases/stripe/*`
  - Stripe connection, webhook verification, customer handling, and
    idempotency patterns should be reused.
- `src/packages/cli/src/bin/commands/admin.ts`
  - admin support and purchase commands establish preview/commit, fresh-auth,
    reason, and optimistic-concurrency conventions.
- `src/packages/frontend/admin/*`
  - the receivables queue belongs in the existing admin application.

Do not reuse `src/packages/server/purchases/create-invoice.ts` as the new
invoice implementation. It is explicitly deprecated, requires an account, and
turns a paid invoice into account credit. A site-license payment must settle the
commercial order, not increase the customer's spendable CoCalc balance.

## Authority And Multibay Ownership

Commercial agreements and institutional invoices are cluster-global business
records. Their authority must not move when an individual billing contact or
site-license manager changes home bay.

The new commercial tables should be classified in
`util/db-schema/table-ownership.ts` as:

```ts
{
  ownership: "seed-global",
  authority: "seed",
  portability: "stable",
}
```

Required routing rules:

- All commercial-order reads and writes route to the seed authority.
- Stripe invoice reconciliation updates seed-global commercial state.
- A webhook accepted on a non-seed bay forwards the verified event or an
  idempotent reconciliation request to the seed service.
- Site-license fulfillment stays seed-global.
- Fulfillment affecting account-owned products routes explicitly to the
  customer's home bay.
- Fulfillment affecting projects routes explicitly to the project's owning
  bay.
- Account rehome must not move commercial orders or invoices.
- Launchpad uses the same code path with its only bay acting as seed.

## Domain Model

Use the user-facing term **commercial order** for the accepted or proposed
agreement and **receivables** for the operational queue.

### Commercial Order

A commercial order is the durable agreement and coordination record. It exists
before an invoice and remains after payment.

Suggested table: `commercial_orders`.

Minimum fields:

```ts
type CommercialOrder = {
  id: string;
  order_number: string; // stable human identifier, e.g. AR-2026-000123

  crm_organization_id?: number;
  organization_name: string; // legal/display snapshot
  customer_account_id?: string;
  site_license_id?: string;
  zendesk_ticket_ids: number[];

  workflow_state:
    | "draft"
    | "awaiting_customer"
    | "ready_to_invoice"
    | "awaiting_payment"
    | "complete"
    | "cancelled";
  collection_mode:
    | "stripe_invoice"
    | "manual_invoice"
    | "complimentary";
  collection_state:
    | "not_invoiced"
    | "draft_invoice"
    | "open"
    | "partially_paid"
    | "paid"
    | "overdue"
    | "void"
    | "uncollectible"
    | "waived";
  fulfillment_state:
    | "not_provisioned"
    | "provisioned"
    | "ended";

  currency: string; // ISO currency, initially USD only
  agreed_subtotal: string; // exact decimal money string
  agreed_total?: string; // final amount after known tax/adjustment
  service_starts_at?: Date;
  service_ends_at?: Date;
  payment_terms_days?: number;

  po_number?: string;
  customer_reference?: string;
  terms_snapshot: Record<string, unknown>;

  assignee_account_id?: string;
  next_action: string;
  next_action_due_at?: Date;

  approved_at?: Date;
  approved_by_account_id?: string;
  provisioned_at?: Date;
  completed_at?: Date;
  cancelled_at?: Date;

  created_by_account_id: string;
  created_at: Date;
  updated_at: Date;
  version: number;
};
```

Money must use the repository's decimal money utilities and an exact Postgres
numeric representation. Do not use JavaScript floating-point arithmetic for
stored or compared totals.

`organization_name` and `terms_snapshot` deliberately preserve what was agreed
at the time. Later edits to CRM or site-license records must not silently alter
the commercial agreement.

### Line Items

Suggested table: `commercial_order_items`.

Fields:

- `id`
- `commercial_order_id`
- `position`
- `description`
- `quantity`
- `unit_amount`
- `subtotal`
- `service_start`
- `service_end`
- `product_kind`
- `product_reference`
- `metadata`
- `created_at`
- `updated_at`

Use line items even if the first real orders have only one item. Universities
often need separate student, instructor, support, or service-period lines on an
invoice. The sum of line items must equal the order subtotal.

### Contacts

Suggested table: `commercial_order_contacts`.

Fields:

- `id`
- `commercial_order_id`
- `crm_person_id`, when linked
- `role`: `primary`, `billing`, `procurement`, `technical`, or `manager`
- `name_snapshot`
- `email_snapshot`
- `organization_snapshot`
- `created_at`
- `updated_at`

Invoice delivery uses the snapshot recorded on the order. CRM edits should not
change where an already approved invoice is sent without an explicit order
update and audit event.

### Invoices

Suggested table: `commercial_invoices`.

An order may have more than one invoice over its lifetime because a draft can
be replaced, an invoice can be voided and reissued, or an agreement can use
installments. The first UI may enforce one active non-void invoice at a time.

Fields:

- `id`
- `commercial_order_id`
- `provider`: initially `stripe`
- `provider_customer_id`
- `provider_invoice_id`, unique when set
- `provider_payment_intent_id`
- `status`: provider-normalized draft/open/paid/void/uncollectible state
- `currency`
- `subtotal`
- `tax`
- `total`
- `amount_due`
- `amount_paid`
- `due_at`
- `hosted_invoice_url`
- `invoice_pdf_url`
- `sent_at`
- `paid_at`
- `voided_at`
- `last_reconciled_at`
- `provider_snapshot`
- `created_at`
- `updated_at`

Provider snapshots are admin-only diagnostics. Do not place secrets, card data,
or unnecessary personal data in them.

### Payments And Manual Settlements

Suggested table: `commercial_payments`.

Fields:

- `id`
- `commercial_order_id`
- `commercial_invoice_id`, when applicable
- `provider`
- `provider_payment_id`, unique when set
- `amount`
- `currency`
- `status`
- `received_at`
- `method`: `card`, `ach`, `bank_transfer`, `check`, `wire`, `credit`, or
  `other`
- `recorded_by_account_id`, for manual settlements
- `evidence_reference`, for a check number or bank reference
- `created_at`
- `updated_at`

Manual payment recording requires elevated permission, fresh authentication,
an audit reason, and a reviewed amount. It must not accept or store bank account
or card details.

### Audit Events

Suggested table: `commercial_order_events`.

Every mutation creates an immutable event in the same transaction as the state
change where possible.

Fields:

- `id`
- `commercial_order_id`
- `event_type`
- `actor_account_id`, nullable for system/webhook events
- `source`: `admin-ui`, `cli`, `stripe-webhook`, `reconciler`, or `migration`
- `reason`
- `idempotency_key`
- `before`
- `after`
- `metadata`
- `created_at`

The unique identity should reject replay of the same mutation while still
allowing the event log to describe every successful transition.

## State Model And Invariants

### Workflow State

`workflow_state` answers what humans need to do next:

- `draft`: terms are incomplete or unapproved.
- `awaiting_customer`: waiting for acceptance, billing details, PO, or another
  customer response.
- `ready_to_invoice`: terms and delivery details are complete and reviewed.
- `awaiting_payment`: an invoice or approved manual payment request is open.
- `complete`: collection and required fulfillment are complete.
- `cancelled`: the agreement will not proceed.

### Collection State

Collection state reflects invoice and payment facts. It must not be manually
set to `paid` except through the explicit manual-settlement operation.

`overdue` is derived from an open balance and due date, then persisted by the
reconciler for filtering and events. A missed scheduled job must not make an
invoice appear paid or complete.

### Fulfillment State

Fulfillment is independent:

- A university can be `provisioned` while collection is `not_invoiced` or
  `open`.
- An invoice can be `paid` while fulfillment is `not_provisioned`.
- The admin queue must prominently expose both exceptional combinations.
- Overdue payment must not automatically disable an active license in the first
  implementation.

### Required Invariants

- `site_license_id` does not imply `collection_state = paid`.
- `collection_state = paid` does not imply `fulfillment_state = provisioned`.
- A paid institutional invoice never creates generic account credit.
- An invoice cannot be sent until the order is approved and has a billing
  contact, positive total, currency, and line items.
- There is at most one active non-void invoice unless installments are
  explicitly enabled.
- Order totals and line items become immutable once the first invoice is
  finalized. Corrections require void/reissue or an explicit revision flow.
- Stripe objects include `commercial_order_id` and internal invoice id in
  metadata.
- Provider invoice and payment IDs are unique.
- Webhook and CLI retries are idempotent.
- Every order that is not complete or cancelled has an assignee or appears in
  the unassigned queue.
- Every open order has a nonempty next action and, after the initial migration,
  a next-action due date.
- Completion requires the configured collection requirement and fulfillment
  requirement to be satisfied.

## Stripe Invoice Workflow

### Customer Resolution

Institutional invoices must not require the organization to map cleanly to one
CoCalc account.

Resolution order:

1. Reuse the Stripe customer already attached to the commercial organization.
2. Reuse the billing account's Stripe customer only when an admin explicitly
   confirms it represents the organization.
3. Otherwise create an organization Stripe customer using the approved billing
   contact and legal organization details.

Persist the selected Stripe customer on the commercial order or invoice. Avoid
creating duplicate customers on retries by using an idempotency key derived
from the order.

### Preview And Draft

Invoice creation is a two-step operation:

1. `preview` returns the exact customer, contacts, line items, amount, tax
   behavior, due date, PO fields, memo, and metadata without creating or sending
   anything.
2. `create --commit` creates a Stripe draft and stores the provider identity.

Draft creation must not automatically send the invoice. An admin reviews the
draft in CoCalc or Stripe before finalization.

### Finalize And Send

`send` must:

- require fresh auth and a human-readable reason;
- require `expected_updated_at` or `version`;
- verify that the Stripe draft still matches the approved order;
- finalize and send with `collection_method = send_invoice`;
- store the hosted invoice URL, PDF URL, due date, and sent timestamp;
- transition the order to `awaiting_payment`;
- create an audit event;
- optionally create a private Zendesk note with the invoice identity and URL.

Stripe supports a hosted invoice page for payment, invoice viewing, PDF, and
receipts. Use invoice custom fields for PO numbers and customer references.

References:

- https://docs.stripe.com/invoicing/hosted-invoice-page
- https://docs.stripe.com/invoicing/customize
- https://docs.stripe.com/invoicing/integration/workflow-transitions

### Failure Recovery

Provider calls and local commits cannot be one atomic transaction. Every
provider mutation must be recoverable:

- Use stable Stripe idempotency keys for customer, draft, finalize, and send
  operations.
- Put the commercial order id in Stripe metadata before finalization.
- If Stripe succeeds and the local write fails, reconciliation must discover
  and attach the Stripe object.
- If the local intent exists but Stripe failed, retry with the same idempotency
  key.
- Never create a second invoice merely because the first RPC timed out.

### Webhooks And Reconciliation

Webhook handling should consume relevant invoice/payment transitions and
upsert normalized state idempotently. At minimum handle:

- invoice finalized or sent;
- invoice paid or payment succeeded;
- payment failed;
- invoice voided;
- invoice marked uncollectible.

Webhooks are a prompt update mechanism, not the only recovery mechanism. Add a
scheduled reconciler that:

- fetches every nonterminal Stripe invoice that has not been reconciled within
  the configured interval;
- repairs missed or out-of-order webhook state;
- recalculates paid and overdue order states;
- records reconciliation failures and retry counts;
- alerts on provider/local amount or currency mismatches.

## Purchase Ledger And Revenue Semantics

The commercial tables are authoritative for institutional accounts receivable.
The existing `purchases` table remains authoritative for user account balance
and product purchases.

Initial rules:

- Do not create account credit when a commercial invoice is paid.
- Record the payment in `commercial_payments`.
- Link an existing product purchase using an optional `purchase_id` only when
  the product's current accounting flow requires one.
- Never create an offsetting credit merely to make an admin-assisted free
  purchase appear funded.
- Revenue analytics must aggregate commercial payments separately or through a
  dedicated immutable projection, then explicitly combine them with account
  ledger revenue.
- Refunds, credit notes, and write-offs must reference the commercial order and
  original payment rather than editing history.

A later accounting integration can export immutable commercial payment facts
to bookkeeping software. That is separate from operational receivables.

## Fulfillment Adapters

Fulfillment should be product-specific behind a common interface:

```ts
type CommercialFulfillmentAdapter = {
  preview(order): Promise<FulfillmentPlan>;
  provision(order, idempotencyKey): Promise<FulfillmentResult>;
  inspect(order): Promise<FulfillmentStatus>;
};
```

### Site License Adapter

The first adapter should support site licenses:

- link an already-created site license without changing it;
- create or update a site license from an approved order plan;
- record the exact pools, domains, managers, and term in `terms_snapshot`;
- verify that the provisioned license still matches the approved order;
- allow explicit provision-before-payment;
- mark fulfillment without changing collection state;
- use existing site-license audit and seed-global operations.

Provision-before-payment should require an explicit reviewed flag such as
`--allow-before-payment`, but should be a normal supported university workflow,
not a break-glass operation.

Future adapters may support course packages, team packages, software licenses,
dedicated hosts, and professional services. Do not generalize the first adapter
beyond the interface needed for site licenses.

## Backend API

Use Conat RPC, not Next API routes.

Suggested modules:

- `src/packages/conat/hub/api/commercial-orders.ts`
- `src/packages/server/commercial-orders/store.ts`
- `src/packages/server/commercial-orders/state.ts`
- `src/packages/server/commercial-orders/invoices/stripe.ts`
- `src/packages/server/commercial-orders/reconcile.ts`
- `src/packages/server/commercial-orders/fulfillment/site-license.ts`
- `src/packages/server/conat/api/commercial-orders.ts`

Suggested read operations:

- `commercialOrders.list`
- `commercialOrders.get`
- `commercialOrders.events`
- `commercialOrders.invoicePreview`
- `commercialOrders.fulfillmentPreview`
- `commercialOrders.reconcilePreview`

Suggested mutation operations:

- `commercialOrders.create`
- `commercialOrders.update`
- `commercialOrders.assign`
- `commercialOrders.addNote`
- `commercialOrders.approve`
- `commercialOrders.cancel`
- `commercialOrders.createInvoiceDraft`
- `commercialOrders.sendInvoice`
- `commercialOrders.voidInvoice`
- `commercialOrders.recordManualPayment`
- `commercialOrders.reconcileInvoice`
- `commercialOrders.provision`
- `commercialOrders.endFulfillment`

All mutations must:

- verify admin permission;
- require fresh authentication for financial, approval, and fulfillment
  actions;
- require an audit reason;
- use optimistic concurrency through `expected_updated_at` or `version`;
- accept or derive a stable idempotency key;
- execute on the seed authority;
- return the updated order and audit event.

List RPCs need filters for state, assignee, organization, ticket, site license,
due date, amount, stale age, and free-text search. Responses need strict row and
byte caps and cursor pagination.

## CLI

Add `cocalc admin receivables` using the same backend RPCs as the admin UI.

Read commands:

```sh
cocalc admin receivables list --state ready-to-invoice,overdue --json
cocalc admin receivables list --assignee me --needs-action --json
cocalc admin receivables show AR-2026-000123 --json
cocalc admin receivables events AR-2026-000123 --json
```

Create and update:

```sh
cocalc admin receivables create --file order.json --reason "accepted pilot"
cocalc admin receivables assign AR-2026-000123 --user wstein@gmail.com \
  --reason "taking collection ownership"
cocalc admin receivables update AR-2026-000123 --file changes.json \
  --expected-updated-at <timestamp> --reason "billing contact confirmed"
cocalc admin receivables note AR-2026-000123 --file note.md \
  --reason "record procurement update"
```

Invoice operations:

```sh
cocalc admin receivables invoice preview AR-2026-000123
cocalc admin receivables invoice create AR-2026-000123 \
  --expected-updated-at <timestamp> --reason "approved invoice draft"
cocalc admin receivables invoice send AR-2026-000123 \
  --expected-updated-at <timestamp> --reason "billing contact approved" --commit
cocalc admin receivables invoice reconcile AR-2026-000123 \
  --reason "verify Stripe state"
```

Fulfillment and settlement:

```sh
cocalc admin receivables fulfill site-license AR-2026-000123
cocalc admin receivables fulfill site-license AR-2026-000123 \
  --allow-before-payment --expected-updated-at <timestamp> \
  --reason "university approved for early activation" --commit
cocalc admin receivables payment record AR-2026-000123 --amount 3900 \
  --method check --reference <reference> \
  --expected-updated-at <timestamp> --reason "check deposited" --commit
```

Mutation commands preview by default and require `--commit` for effects. Human
output must be reviewable; `--json` must be stable enough for authorized agents
and automation.

## Admin UI

Add an Accounts Receivable page under the existing admin application, likely
implemented in `src/packages/frontend/admin/receivables/`.

### Queue Views

Default saved views:

- Needs action
- Unassigned
- Awaiting customer
- Ready to invoice
- Open invoices
- Overdue
- Paid but not provisioned
- Provisioned but not paid
- Stale next action
- Completed
- All

Each row should show:

- order number;
- organization;
- amount and currency;
- workflow, collection, and fulfillment badges;
- assignee;
- next action and due date;
- invoice age or days overdue;
- linked Zendesk ticket;
- linked site license;
- last activity.

### Order Detail

The detail page should include:

- agreement summary and immutable term snapshot;
- contacts and billing delivery address;
- line items and totals;
- invoice status, hosted page, and PDF links;
- fulfillment status and linked resource;
- owner and next action;
- linked support correspondence;
- chronological audit timeline;
- previewed actions for invoice, payment, and fulfillment operations.

Do not provide a generic editable JSON surface for money or status. Use explicit
forms and state-transition actions. After approval, changing money or terms
must require an explicit revision action.

Before implementing the frontend, follow `src/.agents/accessibility.md`.
Interactive controls need labels, keyboard support, focus handling, confirmation
for irreversible actions, and focused accessibility tests.

## Zendesk Integration

Zendesk remains the communication record, but it must visibly link to the
commercial order.

Initial integration:

- store one or more ticket IDs on the order;
- show ticket status and last update in the order detail;
- allow opening the ticket directly from the admin page;
- optionally add a private Zendesk note when an invoice is sent, paid, voided,
  or provisioned;
- include the commercial order number in those notes.

Do not automatically send public Zendesk replies in the first implementation.
Invoice delivery and support communication are distinct reviewed actions.

Longer term, support triage should show a commercial badge summarizing order
state so an agent does not have to search the receivables page manually.

## Internal Follow-Up And Notifications

Every nonterminal order must have an assignee or be visibly unassigned. The
system should not depend on one person's private reminders.

Add a scheduled internal worker that:

- updates derived overdue states;
- identifies missing or past-due next actions;
- identifies unassigned open orders;
- identifies paid-but-unfulfilled and fulfilled-but-unpaid orders;
- runs Stripe reconciliation for stale nonterminal invoices;
- emits admin notifications or a daily internal digest.

Customer-facing reminders remain disabled by default. Stripe reminder settings
or CoCalc-generated reminders can be enabled later after message templates and
escalation policy are approved.

## Security And Permissions

Initial release may require membership in the existing `admin` group, but API
boundaries should support narrower capabilities later:

- `commercial_read`
- `commercial_write`
- `commercial_approve`
- `commercial_invoice_send`
- `commercial_manual_settlement`
- `commercial_fulfillment`
- `commercial_audit_read`

Security requirements:

- Financial and fulfillment mutations require fresh auth.
- Read access is admin-only and audited where sensitive customer information is
  exposed.
- Mutation reason is mandatory.
- Preview and commit are separate.
- Optimistic concurrency rejects stale browser tabs and agent plans.
- Stripe webhook signatures are verified before processing.
- Provider retries use stable idempotency keys.
- Manual settlement requires a second confirmation in UI and `--commit` in
  CLI.
- Hosted invoice URLs are admin-only because they authorize access to customer
  invoice details.
- Logs must not contain payment credentials or complete provider payloads.
- Existing dangerous RPC registry tests must classify all new mutations.

For higher-value invoices, a later policy may require a second admin to approve
send, manual settlement, refunds, or write-offs above a configurable threshold.
Do not block the first release on dual approval.

## Observability

Add structured metrics and logs for:

- open order count and amount by workflow/collection state;
- overdue count and amount;
- unassigned and stale-next-action counts;
- fulfilled-but-unpaid count and amount;
- paid-but-unfulfilled count and amount;
- invoice create/send failure count;
- reconciliation lag and failure count;
- webhook-to-local-update latency;
- provider/local amount mismatch count;
- idempotent replay and optimistic-concurrency rejection count.

Important failures should create central-log events with order and invoice IDs,
but not customer payment details.

## Delivery Phases

### Phase 0: Final Audit And Contracts

- Inventory existing Stripe invoice creation and webhook paths.
- Confirm seed routing for current Stripe events.
- Confirm legal invoice sender identity, address, tax settings, and enabled
  payment methods.
- Define the exact site-license fulfillment request shape.
- Define shared money and status types.
- Add table ownership entries before writing service code.

Exit criteria:

- Schema and state-transition review complete.
- No path relies on generic account credit for institutional settlement.

### Phase 1: Shared Source Of Truth

- Add commercial order, item, contact, invoice, payment, and event schemas.
- Add migrations and ownership classifications.
- Implement seed-authoritative store and state-transition validation.
- Implement list/get/create/update/assign/note/approve/cancel RPCs.
- Add CLI list/show/create/update/assign/note commands.
- Add admin queue and order detail with manual workflow management.
- Add audit timeline and Zendesk/site-license links.

This phase intentionally works before Stripe automation. It immediately
replaces private lists and makes every accepted agreement visible.

Exit criteria:

- Any admin can find all open orders and identify the owner and next action.
- CLI and admin UI show the same records and states.
- No open order can disappear merely because one employee is unavailable.

### Phase 2: Stripe Draft And Send

- Implement organization Stripe customer resolution.
- Implement invoice preview and draft creation.
- Implement reviewed finalize/send.
- Add PO number, customer reference, memo, due date, and metadata support.
- Persist hosted invoice and PDF links.
- Add UI and CLI invoice actions.
- Add private Zendesk note integration.

Exit criteria:

- An admin can create and send a real test-mode invoice without using the Stripe
  dashboard.
- Repeating a timed-out request cannot create a duplicate invoice.

### Phase 3: Payment Reconciliation

- Integrate invoice/payment webhook transitions.
- Add scheduled reconciliation and mismatch detection.
- Add commercial payment records.
- Add explicit manual settlement.
- Add overdue and exceptional-state queues.
- Add revenue projection inputs without changing account balance.

Exit criteria:

- Stripe payment updates the order idempotently.
- Missed and out-of-order webhooks are repaired automatically.
- A paid institutional invoice never creates spendable account credit.

### Phase 4: Site-License Fulfillment

- Implement site-license fulfillment preview and provision operations.
- Support linking an already-created license.
- Support approved provision-before-payment.
- Add drift inspection between order terms and provisioned license.
- Expose paid-but-unfulfilled and fulfilled-but-unpaid prominently.

Exit criteria:

- A complete site-license deal can move from accepted offer through invoice,
  early provisioning, payment, and completion in one visible workflow.

### Phase 5: Operational Automation

- Add internal reminders and daily digest.
- Add stale-action, unassigned, and overdue alerts.
- Add CSV/JSON exports for bookkeeping and management review.
- Add configurable Stripe reminder policy only after message review.
- Add scoped commercial permissions if support roles require them.

Exit criteria:

- No open receivable depends on a private list or individual memory.
- Management can reconcile the queue against Stripe and fulfilled licenses.

## Migration And Initial Backfill

Do not automatically infer commercial orders from every historical Stripe
invoice, purchase, site license, or Zendesk ticket. Their semantics are too
ambiguous, and automatic inference risks double invoicing.

Provide explicit import/link operations:

- create an order from reviewed terms;
- link an existing site license;
- link an existing Stripe customer or invoice;
- reconcile the linked Stripe invoice;
- record a historical/manual payment with evidence and audit reason;
- mark a historical order complete without creating new financial effects.

For launch, manually enter all known active sales-assisted agreements and
pending collections. Run diagnostics for:

- active site licenses with commercial metadata but no linked order;
- open Stripe invoices with CoCalc metadata but no linked order;
- recent accepted support offers without an order;
- orders without assignees or next actions.

These reports are review queues, not automatic mutation jobs.

## Testing Strategy

### Schema And State Tests

- Exact money and line-item sum validation.
- Allowed and rejected workflow transitions.
- Collection and fulfillment independence.
- Immutability after invoice finalization.
- Unique provider invoice/payment IDs.
- Assignee and next-action invariants.
- Completion rules.

### RPC And Security Tests

- Admin permission and fresh-auth enforcement.
- Dangerous RPC registry coverage.
- Seed routing from non-seed bays.
- Optimistic concurrency rejection.
- Idempotency replay.
- Audit event creation for every mutation.
- Result row/byte limits for list/search.

### Stripe Tests

- Customer reuse and idempotent customer creation.
- Preview does not mutate Stripe.
- Draft creation does not send.
- Send requires approved matching terms.
- Timeout after provider success is repaired without duplication.
- Webhook replay is idempotent.
- Out-of-order webhooks converge correctly.
- Missed webhook is repaired by reconciliation.
- Paid, failed, void, and uncollectible transitions.
- Provider/local amount and currency mismatch fails closed.
- Institutional payment does not create account credit.

### Fulfillment Tests

- Link existing site license.
- Provision before payment only with explicit approval.
- Payment does not implicitly provision.
- Provisioning does not implicitly mark paid.
- Retry after timeout is idempotent.
- Order/license drift is visible.
- Multibay fulfillment routes to seed.

### CLI Tests

- List and show JSON stability.
- Preview before commit.
- Required reason, fresh auth, and expected timestamp.
- Stale plan rejection.
- Manual settlement confirmation.
- Clear recovery output after provider timeout.

### Frontend Tests

- Queue filtering and exceptional-state views.
- Order detail timeline.
- Invoice preview confirmation.
- Stale update handling.
- Loading, empty, partial-failure, and retry states.
- Keyboard and screen-reader accessibility.
- No hosted invoice URL exposure to non-admin users.

### End-To-End Validation

In Stripe test mode:

1. Create an order with organization and billing contact.
2. Approve it and generate a draft invoice.
3. Review and send the invoice.
4. Provision a site license before payment.
5. Pay through the hosted invoice page.
6. Verify webhook update, payment record, and completed order.
7. Replay the webhook and retry every prior command.
8. Confirm no duplicate invoice, payment, license, or account credit exists.

Repeat with a deliberately dropped webhook and verify scheduled reconciliation.

## Rollout

1. Deploy schema and read-only APIs.
2. Create the initial reviewed commercial orders with no Stripe mutations.
3. Enable admin queue and CLI visibility for all admins.
4. Enable manual workflow updates and assignment.
5. Enable Stripe draft creation in test mode.
6. Validate one complete test-mode university order.
7. Enable production draft creation for selected admins.
8. Require review before enabling production send.
9. Enable webhook reconciliation and compare against Stripe dashboard.
10. Enable site-license fulfillment actions.

Feature flags should separate:

- receivables visibility;
- order mutation;
- Stripe draft creation;
- Stripe send;
- manual settlement;
- automated reconciliation;
- fulfillment.

Rollback must be able to disable mutations without hiding the shared queue or
audit history.

## Acceptance Criteria

The first complete release is successful when:

- Every sales-assisted agreement can be represented before payment.
- Every admin can see all pending receivables from the web and CLI.
- Every open order has a visible owner and next action.
- Stripe invoices can be previewed, created, and sent without the Stripe
  dashboard.
- Payment status converges after webhook loss or replay.
- Existing and new site licenses can be linked and fulfilled independently of
  payment.
- No institutional invoice payment creates generic account credit.
- Every financial and fulfillment action is attributable and auditable.
- Another support employee or authorized agent can continue the workflow when
  the original owner is unavailable.

## Defaults Requiring Confirmation During Implementation

The implementation can proceed with these defaults, but production enablement
must confirm them:

- USD-only orders initially.
- Net 21 invoice terms unless an order specifies otherwise.
- Stripe-hosted invoices with enabled card and bank payment methods.
- Stripe automatic tax only when customer tax status and site configuration
  have been reviewed.
- One active non-void invoice per order initially.
- No automatic customer dunning or license suspension.
- Existing admins can read; fresh-auth admins can mutate.
- Manual settlement is allowed only with an external reference and reason.
- Dual approval is deferred until volume or invoice size justifies it.
