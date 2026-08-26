# Stripe-Native Commercial Quotes Plan

## Decision

Add Stripe Quotes as a provider-backed mode of the existing Accounts
Receivable quote workflow. Do not delete CoCalc's commercial quote records or
make Stripe the commercial source of truth.

Stripe Quotes provide the standard lifecycle we want: a draft can be reviewed
and finalized, a finalized quote has a Stripe-generated PDF, and accepting a
one-time quote creates a draft invoice. This is materially better than creating
an unrelated PDF and then independently recreating the same terms as an
invoice.

There is one deployment prerequisite: Stripe currently requires Invoicing Plus
to finalize, download, or accept one-time Quotes in live mode. Sandbox testing
is available without enabling live delivery. Confirm the production Stripe
account's plan and pricing before enabling the feature.

Official references:

- <https://docs.stripe.com/quotes>
- <https://docs.stripe.com/api/quotes>
- <https://docs.stripe.com/quotes/create>

## Authority Boundaries

- The commercial order remains the authoritative accepted terms and workflow.
- `commercial_quotes` remains the durable local quote and audit identity.
- Stripe owns its provider quote state and generated PDF.
- `commercial_invoices` remains the local invoice identity after quote
  acceptance creates a Stripe invoice.
- Every provider mutation routes to the seed and uses the existing durable
  provider-operation reservation pattern. No bay directly mutates Stripe.

## Data Model

Extend `commercial_quotes` rather than introduce a parallel quote table:

- `provider`: `local` or `stripe`, defaulting existing rows to `local`;
- `provider_quote_id`: unique nullable Stripe `qt_...` id;
- `provider_status`: nullable Stripe draft/open/accepted/canceled status;
- `provider_invoice_id`: nullable Stripe invoice created on acceptance;
- `provider_snapshot`: bounded, redacted JSON needed for reconciliation;
- `provider_updated_at` and `last_reconciled_at`;
- retain the local immutable terms snapshot and SHA-256 PDF metadata.

For Stripe-backed quotes, store the finalized Stripe PDF in the existing quote
document columns after downloading and hashing it. This keeps historical
documents available even if provider access later changes. Never expose the
Stripe secret or unrestricted provider payload.

Add provider operations for:

- `quote_create`;
- `quote_finalize`;
- `quote_accept`;
- `quote_cancel`;
- `quote_reconcile`.

Each operation must reserve an idempotency key before the Stripe call and
support `reserved`, `remote_started`, `completed`, and `indeterminate` recovery
exactly like invoice operations.

## Mapping Commercial Terms to Stripe

Only support one-time institutional quotes initially. Recurring quote items
create subscriptions and are explicitly deferred.

- Resolve or create the reviewed Stripe customer using the existing AR customer
  rules.
- Create one reusable/internal Stripe Product for commercial agreements, or a
  bounded product per product kind; do not create an unbounded product per
  order.
- Send each commercial item as inline one-time `price_data`, using integer
  quantity and exact currency minor units.
- Set `collection_method=send_invoice` and map reviewed payment terms to
  `invoice_settings.days_until_due`.
- Include the commercial order id and order number in Stripe metadata.
- Map the reviewed quote memo/header/footer within Stripe's documented field
  limits. Surface truncation as a blocker, never silently truncate legal terms.
- Fail closed unless Stripe's computed subtotal, total, and currency exactly
  match the commercial snapshot.

## Lifecycle

1. **Preview** validates the order, customer, line items, minor-unit conversion,
   payment terms, live/test mode, and Invoicing Plus readiness. No provider
   mutation occurs.
2. **Create draft** creates a Stripe draft quote through a reserved provider
   operation and records its id and redacted snapshot locally.
3. **Finalize** re-retrieves and validates provider amounts, finalizes the
   quote, downloads its PDF, stores its digest and bytes, and marks the local
   quote issued/open.
4. **Accept** is a separate reviewed fresh-auth action after documented customer
   acceptance. It accepts the Stripe quote, verifies the generated draft
   invoice, and adopts that invoice into `commercial_invoices` in the same local
   transaction used to complete the provider operation.
5. **Send invoice** continues through the existing invoice preview/finalize/send
   workflow. Quote acceptance must never automatically send the invoice.
6. **Cancel** maps to Stripe cancel and local void, retaining the PDF and audit
   history.
7. **Reconcile** repairs timeouts and webhook gaps without creating replacement
   quotes or invoices.

## Webhooks and Recovery

Handle `quote.finalized`, `quote.accepted`, and `quote.canceled` in the durable
Stripe event inbox. Correlate by Stripe id and verified commercial metadata.
Also correlate the invoice created by quote acceptance through both the
Quote's `invoice` field and commercial metadata.

Unexpected provider transitions, amount mismatches, an unknown generated
invoice, or a live/test mismatch enter diagnostics and block further mutation.
They are never normalized silently.

## API, CLI, and UI

Add seed-routed RPCs and complete CLI parity:

```text
cocalc admin receivables quote stripe preview <order>
cocalc admin receivables quote stripe create <order>
cocalc admin receivables quote stripe finalize <order> --quote-id <uuid>
cocalc admin receivables quote stripe accept <order> --quote-id <uuid>
cocalc admin receivables quote stripe cancel <order> --quote-id <uuid>
cocalc admin receivables quote stripe reconcile <order> --quote-id <uuid>
```

Every mutation is dry-run first, fresh-authenticated on commit, optimistic,
idempotent, and audited. The AR UI should present Local PDF and Stripe as clear
provider choices, show provider and local states together, link to the Stripe
Dashboard, and require explicit confirmation that customer acceptance was
received before accepting a quote.

## Rollout

Add independent site settings:

- `commercial_receivables_stripe_quotes_enabled` for sandbox draft creation;
- `commercial_receivables_stripe_quote_finalize_enabled` for finalization/PDF;
- `commercial_receivables_stripe_quote_accept_enabled` for invoice conversion.

Roll out in this order:

1. Confirm Invoicing Plus cost and enable sandbox-only create/finalize.
2. Validate exact totals, PDF retention, cancellation, retry, and timeout
   recovery on Lite4b using Stripe test mode.
3. Validate accepting a quote creates exactly one draft invoice and that the
   existing AR invoice workflow can send and collect it.
4. Add webhook replay and dropped-webhook recovery tests.
5. Enable live creation/finalization for admins while leaving acceptance off.
6. Enable acceptance only after multiple real quote reviews and an operator
   runbook update.

Keep the local PDF provider available during rollout and as a fallback for
sites without Invoicing Plus. Do not migrate or rewrite already-issued local
quotes.
