# Accounts Receivable Operations

CoCalc's commercial-order workflow is the shared source of truth for
sales-assisted agreements, invoicing, payment collection, and fulfillment.
Stripe delivers invoices and accepts payment. Zendesk records customer
communication. Neither replaces the commercial order.

## Authority And Access

Commercial tables are seed-global. Public Conat requests may originate on any
bay, but all reads and writes route to the cluster seed. Launchpad follows the
same route with its only bay acting as seed.

The initial authorization policy is:

- Admin membership is required for every operation.
- Financial, approval, migration, and fulfillment mutations require fresh
  authentication and reject impersonation.
- Every read and mutation requires a human-readable audit reason.
- Mutations use `expected_version` and a stable idempotency key.
- CLI mutations preview by default and require `--commit` for effects.

Never include payment credentials, bank account details, card details, or full
provider payloads in an order, note, evidence reference, or audit reason.

## Rollout Controls

Enable these site settings independently under **Billing & Commerce / Accounts
Receivable**:

| Setting                                            | Effect                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| `commercial_receivables_visible`                   | Admin queue, detail, audit, preview, and diagnostics reads.                       |
| `commercial_receivables_mutations_enabled`         | Order creation, editing, assignment, notes, approval, cancellation, and backfill. |
| `commercial_receivables_stripe_drafts_enabled`     | Stripe draft creation and reviewed adoption of an existing Stripe invoice.        |
| `commercial_receivables_stripe_send_enabled`       | Stripe invoice finalize/send and void.                                            |
| `commercial_receivables_manual_settlement_enabled` | Recording externally verified checks, wires, or other manual settlements.         |
| `commercial_receivables_reconciliation_enabled`    | Manual reconciliation, durable webhook processing, and scheduled reconciliation.  |
| `commercial_receivables_fulfillment_enabled`       | Site-license linking, provisioning, and ending fulfillment.                       |

All controls default off. Normal rollout enables visibility first, then order
mutations, Stripe drafts in test mode, Stripe send, reconciliation, and finally
fulfillment/manual settlement. Rollback should disable effectful controls while
leaving visibility enabled.

## Standard Workflow

1. Create an order from reviewed terms. Record the organization snapshot,
   billing contact, exact line items, service dates, linked Zendesk tickets,
   owner, next action, and due date.
   Select the next action from the standard receivables task list. Put
   customer-specific instructions and context in an audited internal note.
2. Approve the order after validating the customer agreement and delivery
   details.
3. Preview the invoice. Resolve every blocker before creating a Stripe draft.
4. Create a draft. This never sends automatically.
5. Review the Stripe customer, contact, line items, total, currency, Net 21 (or
   explicit negotiated) terms, PO/reference fields, and test/live mode.
6. Send the invoice with fresh auth and the current order version.
7. Preview and provision the site license. Provision-before-payment is allowed
   only with the explicit reviewed flag.
8. Let Stripe webhooks update payment state. The scheduled reconciler repairs
   dropped or out-of-order webhooks.
9. The order becomes complete only when its configured collection and
   fulfillment requirements are both satisfied.

Collection and fulfillment are intentionally independent. Provisioning a site
license does not mark an invoice paid, and payment does not provision a license.

## Recovery And Idempotency

Stripe calls and database commits cannot form one transaction. Provider
operations therefore reserve durable idempotency keys before remote calls.

- Retry a timed-out command with the same input and idempotency key.
- Do not create a replacement invoice after a timeout.
- Run invoice reconcile when Stripe may have succeeded but local state is
  uncertain.
- `indeterminate` provider operations and failed webhook events appear in
  diagnostics review queues.
- An existing Stripe invoice can be adopted only after mode, currency, total,
  and ownership metadata validation.
- Webhook replay is safe and never creates generic CoCalc account credit.

There may be only one active creating, draft, or open invoice per order.
Corrections after finalization use void and reissue rather than editing history.

## Manual Payments

Use manual settlement only after verifying an external payment independently.
Record the exact amount, currency, received date, method, and a non-secret
reference such as a check number or bank confirmation identifier. The command
requires fresh auth, the current version, an audit reason, and `--commit`.

Manual settlement records a commercial payment. It does not add spendable
credit to a CoCalc account.

## Site-License Fulfillment

The approved `terms_snapshot.site_license` plan records owner, managers,
domains, pools, service term, and policy metadata. Preview reports whether the
operation will create, link, or leave a license unchanged. Provision verifies
the resulting license against the approved snapshot and stores the license id
on the order.

Use `--allow-before-payment` only when early activation was explicitly
approved. Ending fulfillment never rewrites collection history and overdue
payment never automatically suspends a university license.

## Diagnostics And Follow-Up

The seed worker runs under a database lease so only one hub processes each
maintenance interval. It:

- processes the durable Stripe webhook inbox;
- reconciles stale nonterminal invoices;
- updates overdue and exceptional queues;
- publishes aggregate Prometheus metrics and central-log events;
- emits one durable-watermarked internal digest per UTC day.

Diagnostics include open/unassigned/overdue totals, paid-but-unprovisioned and
provisioned-but-unpaid records, stale invoices, inconsistent orders, failed
Stripe events, indeterminate provider operations, open orders without due
dates, and active commercial site licenses that are not represented by an
order.

These are human review queues. Backfill is preview-first and never infers every
historical invoice, site license, purchase, or support ticket automatically.

## Stripe Test Validation

Before production send is enabled, complete this in Stripe test mode:

1. Create and approve a test university order.
2. Preview and create a draft.
3. Retry draft creation and verify no duplicate invoice exists.
4. Send it and provision a test site license before payment.
5. Pay through the hosted invoice page.
6. Verify payment, fulfillment, completion, and immutable audit events.
7. Replay the webhook and retry commands; verify no duplicate invoice,
   payment, license, or account credit.
8. Disable webhook processing temporarily, pay another invoice, re-enable it,
   and verify scheduled reconciliation converges.

Provider/local currency or amount mismatches fail closed and must be reviewed;
they are never normalized silently.
