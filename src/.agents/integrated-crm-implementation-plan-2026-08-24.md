# Integrated CRM Implementation Plan

Date: 2026-08-24

Status: proposed implementation plan.

## Executive Decision

CoCalc should add a small, first-party customer relationship layer that joins
the systems it already operates. It must not become a Zendesk replacement or a
generic Salesforce clone.

The canonical record is a **customer organization**. It connects people,
institutional domains, CoCalc accounts, Zendesk tickets, opportunities,
commercial orders, Stripe customers, site licenses, internal tasks, and an
audited activity timeline.

System authority remains deliberately separated:

- Zendesk owns customer-facing support conversations and ticket status.
- Stripe owns invoice delivery and payment-provider settlement state.
- Commercial orders own reviewed terms, collection state, and fulfillment
  coordination.
- Site licenses own institutional entitlements.
- The CRM owns customer identity, relationships, opportunities, internal
  follow-up, and the unified customer timeline.

The implementation is CLI-first. Every supported operation must be available
through `cocalc admin crm`, including search, reads, writes, linking, merging,
backfill, diagnostics, and exports. The admin UI uses the same audited Conat
APIs and must not have capabilities that agents cannot exercise from the CLI.

## Why This Is Needed

CoCalc now has a shared accounts receivable system, but customer context still
lives across employee memory, Zendesk, Stripe, site licenses, CoCalc accounts,
and one-off notes. This makes common questions unnecessarily expensive:

- Which institution is this requester actually associated with?
- Which domains and departments belong to the same customer?
- Who are the decision-maker, instructor, technical, billing, and procurement
  contacts?
- What has CoCalc offered, sold, provisioned, and collected historically?
- Is there an active adoption pilot, renewal, or expansion opportunity?
- Which Zendesk tickets, commercial orders, and site licenses belong together?
- Who owns the next action, and when is it due?
- What was the latest meaningful interaction with the customer?

The CRM should answer these questions without copying authoritative data out of
the systems that already manage it.

## Legacy CRM Decision

The existing CRM implementation was never deployed as a working product on
CoCalc.ai and must be deleted rather than migrated or preserved.

The current schema in `packages/util/db-schema/crm.ts` includes:

- `crm_organizations`
- `crm_people`
- `crm_support_tickets`
- `crm_support_messages`
- `crm_tasks`
- `crm_tags`
- `crm_leads`

The `.cocalc-crm` editor under
`packages/frontend/frame-editors/crm-editor` is likewise unused. It exposes
generic database-table editing through a collaborative file and contains the
beginning of an internal Zendesk replacement. That is not the desired
security, authority, or workflow model.

Production was checked on 2026-08-24 using audited exact-count queries. All
seven legacy tables contain zero rows, and the existing receivables columns
`commercial_orders.crm_organization_id` and
`commercial_order_contacts.crm_person_id` contain zero non-null references.
The corresponding production audit records are
`2b7be29e-d3b8-440d-9e01-969ac8dace1a` and
`6c64bbba-540b-444c-948f-d7c50a5e640d`. There is therefore no legacy customer
data or ID mapping to preserve.

Delete the old implementation directly:

1. Remove the `.cocalc-crm` file type, registration, editor, query helpers,
   views, and legacy direct `user_query` mutation surface.
2. Remove the seven legacy table definitions, ownership entries, and code
   paths that reference them.
3. Drop the seven empty legacy tables. Create the new normalized
   `crm_organizations`, `crm_people`, and `crm_tasks` tables cleanly rather than
   performing in-place conversion or introducing temporary v2 tables.
4. Remove the unused integer CRM reference columns from commercial orders and
   contacts, replacing them with reviewed UUID references when the new CRM
   integration is added.
5. Remove obsolete schema render types used only by the old editor after a
   dependency check confirms there are no other callers.

This deletion applies only to the seven business tables listed above and the
old editor. Other schemas and read models whose names begin with `crm_`, such
as `crm_accounts`, `crm_projects`, `crm_purchases`, and `crm_retention`, are not
part of the abandoned CRM and must not be removed.

## Goals

- Establish one canonical record for each institutional or commercial
  customer.
- Make customer context available to all admins and authorized agents.
- Join, rather than duplicate, Zendesk, Stripe, receivables, site licenses, and
  CoCalc account data.
- Support institutional adoption pilots, sales-assisted purchases, renewals,
  expansions, and private-cloud opportunities.
- Track constrained internal tasks with explicit ownership and due dates.
- Preserve an immutable, searchable activity and mutation history.
- Provide a purpose-built Customer 360 admin page.
- Provide complete, stable, machine-readable CLI coverage.
- Work correctly in one-bay Launchpad and multibay Rocket.
- Make rollout, retries, customer backfill, and external-system linking safe
  and idempotent.

## Non-Goals

- Replace Zendesk ticketing, email delivery, or customer communications.
- Copy full Zendesk ticket threads into CoCalc.
- Replace Stripe, accounting software, or tax reporting.
- Build marketing-email campaigns, call recording, calendar synchronization,
  or generalized workflow automation in the first release.
- Infer contractual relationships solely from an email domain.
- Give non-admin users access to CRM records.
- Provide arbitrary database-table editing.
- Automatically merge organizations or people without review.
- Store card details, bank credentials, secrets, or unrestricted provider
  payloads.

## Authority And Multibay Ownership

CRM records are cluster-global business records. They must be seed-authoritative
and stable when an account or project moves between bays.

Classify all new CRM tables in `util/db-schema/table-ownership.ts` as:

```ts
{
  ownership: "seed-global",
  authority: "seed",
  portability: "stable",
}
```

Required routing behavior:

- All CRM reads and writes route to the seed authority through Conat RPC.
- Launchpad uses the same route with its only bay acting as seed.
- Account and project lookups resolve `home_bay_id` and `owning_bay_id`
  explicitly when authoritative data is needed.
- CRM summary generation must not scan every bay synchronously during an
  interactive request. Use bounded seed projections or explicit asynchronous
  refresh jobs.
- Account rehome and project moves do not move CRM records.
- External webhooks accepted outside the seed forward idempotent events to the
  seed service.

## Canonical Domain Model

### Organizations

`crm_organizations` is the root customer record.

Suggested fields:

```ts
type CrmOrganization = {
  id: string; // UUID
  customer_number: string; // stable display key, e.g. CRM-2026-000123
  display_name: string;
  legal_name?: string;
  aliases: string[];
  website?: string;
  timezone?: string;
  organization_type:
    | "university"
    | "college"
    | "school"
    | "research_lab"
    | "company"
    | "government"
    | "nonprofit"
    | "individual"
    | "other";
  lifecycle_stage:
    | "prospect"
    | "pilot"
    | "customer"
    | "renewal"
    | "former_customer"
    | "inactive";
  relationship_owner_account_id?: string;
  parent_organization_id?: string;
  status: "active" | "merged" | "archived";
  merged_into_organization_id?: string;
  created_by_account_id: string;
  updated_by_account_id: string;
  created_at: Date;
  updated_at: Date;
  version: number;
};
```

Use UUIDs for canonical identity and a human-readable customer number for CLI
and UI display. Names and aliases are not unique identifiers.

### Domains

Use a normalized `crm_organization_domains` relation instead of the current
single `domain` string.

Minimum fields:

- `id`
- `organization_id`
- normalized lower-case ASCII domain
- display form
- kind: `primary`, `secondary`, `department`, or `legacy`
- state: `suggested`, `verified`, `rejected`, or `retired`
- verification method and evidence reference
- generic/disposable-domain flag
- created, verified, and retired timestamps
- actor and version fields

Rules:

- Exact normalized domains are unique among active verified mappings.
- Subdomains do not imply parent ownership automatically.
- Gmail, Outlook, and other generic domains never identify an organization.
- A domain match may suggest a customer; it may not silently attach a person,
  ticket, account, or order.
- Domain verification and conflict resolution require fresh authentication.

### People, Emails, And Accounts

`crm_people` stores durable contact identity. Normalize relationships into:

- `crm_person_emails`
- `crm_person_accounts`
- `crm_organization_people`

A person may have multiple email addresses and CoCalc accounts and may belong
to multiple organizations. Organization-person relationships have constrained
roles such as:

- primary contact
- instructor
- decision-maker
- billing
- procurement
- technical
- site-license manager
- executive sponsor

Store contact snapshots on commercial orders as today. Updating a CRM person
must never rewrite accepted commercial terms or historical invoices.

### External References

Use `crm_external_references` to bind canonical records to external systems.

Minimum fields:

- organization or person target
- provider: `zendesk`, `stripe`, or another reviewed provider
- object kind: organization, requester, ticket, customer, or another
  constrained kind
- external identifier
- optional redacted label and bounded metadata
- verification state, actor, timestamps, and version

Provider/object-kind/external-id must be unique. Do not store unrestricted
Zendesk or Stripe payloads.

### Opportunities

`crm_opportunities` represents a time-bounded possible commercial outcome. It
is distinct from a customer and from an accepted commercial order.

Opportunity kinds initially include:

- adoption pilot
- new site license
- renewal
- expansion
- private cloud
- training or services
- other negotiated agreement

Constrained stages:

```text
discovery -> qualified -> proposal -> verbal_commitment -> procurement -> won
                                                              \-> lost
```

`on_hold` may be entered from any nonterminal stage. Stage transitions must be
validated and audited. Required fields include organization, owner, expected
value, expected close date, service dates where known, source Zendesk tickets,
loss reason for lost opportunities, and the linked commercial order when won.

Winning an opportunity does not mark it paid or fulfilled. It creates or links
the commercial order that owns those later states.

### Tasks

Create a narrow `crm_tasks` model for internal follow-up. A task has:

- organization and optional person/opportunity/order/ticket links
- constrained type: contact, meeting, discovery, proposal, quote, procurement,
  invoice, payment follow-up, provisioning, renewal, technical follow-up, or
  review
- state: open, waiting, completed, or cancelled
- assignee, due date, priority, short subject, and bounded details
- created/completed/cancelled actors and timestamps
- optimistic version

Free-form details explain the task; they do not define its state. Every open
task requires an assignee and due date. Commercial-order `next_action` remains
authoritative for AR execution, but it can appear in a combined work queue.

### Activities And Notes

`crm_activities` is an append-only customer timeline. Activities may be
generated from:

- audited CRM mutations and internal notes
- opportunity stage changes
- task creation and completion
- commercial-order events
- site-license provisioning and renewal
- Stripe invoice/payment references
- linked Zendesk ticket creation or status changes
- explicitly recorded calls or meetings

Store a concise internal summary, source, stable source identifier, actor,
occurred timestamp, organization, and optional linked entity IDs. Do not copy
full Zendesk messages. Corrections append a superseding activity rather than
editing history invisibly.

### Customer Metrics

Customer 360 should display bounded projections, not issue expensive live
cross-bay scans. Suggested daily or on-demand projections include:

- commercial spend by year
- outstanding receivables
- active and historical site licenses
- licensed seat counts and pool composition
- accounts associated through reviewed contact or domain relationships
- aggregate weekly/monthly active users
- aggregate projects and storage where policy permits
- most recent Zendesk interaction

Every metric must state its timestamp and scope. Domain-derived usage is an
estimate and must be labeled as such.

## Existing-System Integration

### Accounts Receivable

- Change `commercial_orders.crm_organization_id` and
  `commercial_order_contacts.crm_person_id` to the canonical CRM identifiers.
- Replace numeric CRM ID inputs with searchable customer/person selectors.
- Allow order creation from a won opportunity with reviewed snapshots.
- Render a direct customer link from every receivables order.
- Append commercial-order events to the customer timeline idempotently.
- Keep accepted order snapshots immutable when the CRM changes.

### Site Licenses

- Add an optional canonical `crm_organization_id` to site licenses.
- Show current and historical site licenses on Customer 360.
- Allow reviewed linking from CRM, receivables, site-license UI, and CLI.
- Do not infer organization identity from allowed domains without review.

### Zendesk

Zendesk remains authoritative for communication.

- Link tickets by stable Zendesk ticket ID.
- Store only bounded ticket metadata needed for search and timeline display.
- Fetch the current redacted thread on demand through `adminSupport` APIs.
- Extend support diagnostics to show linked customer and deterministic customer
  candidates based on reviewed email/account/domain evidence.
- Add preview-first support commands to link or unlink a ticket and customer.
- Never auto-merge customers based on ticket requester email alone.

### Stripe

- Bind reviewed Stripe customers through external references.
- Display invoices and payments from commercial-order state.
- Detect one Stripe customer linked to multiple active CRM customers and queue
  it for review.
- Never copy payment credentials or full Stripe objects into CRM activities.

### CoCalc Accounts And Projects

- Link people to one or more CoCalc accounts through an explicit relation.
- Resolve account identity through existing account selectors and search APIs.
- Do not make every account with a matching domain a CRM person automatically.
- Usage projections may aggregate reviewed domains, explicit contacts, license
  membership, and account relationships, with provenance preserved.

## Conat API

Create a seed-routed `adminCrm` Conat service. Do not add Next API routes or
direct frontend table mutation.

Read methods should include:

- `listOrganizations`
- `searchOrganizations`
- `getOrganization`
- `getCustomerTimeline`
- `listPeople` and `searchPeople`
- `listOpportunities`
- `listTasks`
- `getCustomerMetrics`
- `getDiagnostics`

Mutation methods should include:

- create, update, archive, and merge organization
- add, verify, reject, retire, and transfer domain
- create/update person and manage email/account/organization relationships
- create/update opportunity and transition its stage
- create, reassign, complete, and cancel task
- append internal note, call, or meeting activity
- link/unlink Zendesk, Stripe, account, order, and site-license references
- create a commercial order from an opportunity
- preview and apply reviewed customer discovery/backfill

All methods must use explicit request/response types from
`packages/conat/hub/api`. Reads and mutations route by seed ownership rather
than assuming the serving bay is authoritative.

## CLI-First Contract

The CLI is a primary product surface, not a wrapper added after the UI.

Top-level command:

```sh
cocalc admin crm
```

Required command families:

```text
cocalc admin crm organizations list|search|show|create|update|archive|merge
cocalc admin crm domains add|verify|reject|retire|transfer
cocalc admin crm people list|search|show|create|update|link|unlink
cocalc admin crm opportunities list|show|create|update|transition
cocalc admin crm tasks list|show|create|assign|complete|cancel
cocalc admin crm activities list|note|call|meeting
cocalc admin crm links add|remove
cocalc admin crm order create
cocalc admin crm backfill
cocalc admin crm diagnostics
cocalc admin crm export
```

CLI requirements:

- Every admin UI mutation has an equivalent CLI command.
- Every mutation previews by default and requires `--commit`.
- Committed mutations require `--reason`, `--expected-version`, and a stable
  idempotency key where applicable.
- Security-sensitive writes require cookie-backed fresh authentication and
  reject bearer-only, API-key-only, project-scoped, or impersonated sessions.
- Agents can request fresh auth with `cocalc auth bootstrap` and present the
  approval URL to a human admin.
- Commands accept human identifiers such as customer number, name, domain,
  email, Zendesk ticket, and order number. UUIDs remain accepted but should not
  be required for normal operation.
- Ambiguous selectors fail with a bounded candidate list; they never pick the
  first match silently.
- `--json` returns stable versioned objects with explicit provenance and
  redaction metadata.
- Cursor pagination, output byte limits, and bounded search are mandatory.
- CLI errors provide a human summary, remediation, and structured details.
- No workflow requires browser automation, raw SQL, or an unexposed internal
  endpoint.

Representative agent workflow:

```sh
cocalc admin crm organizations search --domain example.edu --json
cocalc admin crm organizations show CRM-2026-000123 --json
cocalc admin crm links add CRM-2026-000123 \
  --zendesk-ticket 20599 --reason "Link reviewed institutional inquiry"
cocalc admin crm links add CRM-2026-000123 \
  --zendesk-ticket 20599 --reason "Link reviewed institutional inquiry" \
  --expected-version 7 --commit
cocalc admin crm opportunities create CRM-2026-000123 \
  --kind adoption-pilot --owner wstein@sagemath.com \
  --reason "Customer requested an institutional pilot"
```

## Authentication, Authorization, And Audit

- Admin membership is required for every CRM operation.
- Agent RPC tokens receive only the explicitly reviewed `adminCrm.*`
  capabilities.
- All reads require a human-readable audit reason because customer records
  contain PII and commercial context.
- All writes require fresh authentication in the first release. This can be
  relaxed only after an operation-specific security review.
- Merges, domain verification/transfer, external-reference changes, archival,
  exports, and customer backfill always require fresh authentication.
- Impersonated sessions may not access CRM APIs.
- Mutations use optimistic versions, idempotency keys, and append-only audit
  events.
- Search results redact unnecessary PII and are bounded by count and bytes.
- Notes and metadata reject secrets, payment credentials, and oversized
  provider payloads.
- Export operations are audited, fresh-authenticated, bounded, and visibly
  marked as sensitive.

## Admin UI

Add **Admin -> Customers** using the same `adminCrm` API as the CLI.

### Customer Queue

The queue should support:

- search by name, alias, domain, contact, account, customer number, Zendesk
  ticket, commercial order, and site license
- saved fixed views for prospects, pilots, customers, renewals, overdue tasks,
  and unassigned customers
- owner, lifecycle, opportunity stage, recent activity, and next action
- visible data freshness and diagnostics

### Customer 360

One customer page should show:

- identity, aliases, hierarchy, and verified domains
- people, roles, email addresses, and associated CoCalc accounts
- open opportunity and adoption-pilot history
- internal owner, next task, and due date
- receivables, invoices, outstanding balance, and historical spend
- current and historical site licenses and pool composition
- linked Zendesk tickets with on-demand thread access
- aggregate adoption and usage metrics with timestamps/provenance
- append-only notes and activity timeline

Actions include creating an opportunity, creating a commercial order, linking
a Zendesk ticket or site license, adding a task/note, and reviewing a duplicate
merge. Use searchable account, person, organization, and license selectors;
never expose raw UUID text inputs as the normal workflow.

## Legacy Removal And Customer Backfill

### Legacy Removal

The production verification described in **Legacy CRM Decision** is
conclusive: the abandoned editor has no data to migrate. Remove its code and
drop its empty tables before creating the new normalized schema. Do not add
parallel v2 tables, an integer-to-UUID map, an archive, a compatibility layer,
or a retention window for the unused implementation.

The cleanup database migration must be idempotent and narrowly name the seven
tables being removed. The new CRM schema then creates its UUID-based tables
under their final canonical names. Receivables integration adds new UUID
foreign keys directly; it does not convert the unused integer columns.

### Business-System Customer Backfill

Backfill is preview-first and produces candidates, not automatic identity
merges. Candidate sources include:

- commercial-order organization/contact snapshots
- site-license names, owners, managers, and allowed domains
- Stripe customer references already reviewed by receivables
- linked Zendesk ticket/requester metadata
- historical commercial spend and institutional purchases

Each proposal includes evidence and confidence. High-confidence proposals
still require explicit `--commit`; ambiguous proposals enter a review queue.

## Diagnostics And Operations

Diagnostics should identify:

- duplicate normalized domains
- conflicting Stripe or Zendesk references
- active organizations without owners
- open opportunities without a next task
- overdue tasks
- won opportunities without commercial orders
- commercial orders and site licenses without CRM organizations
- people with conflicting email/account relationships
- merged records still referenced as active
- timeline source gaps or duplicate event ingestion
- stale customer metric projections
- failed or indeterminate external-reference synchronization

Publish aggregate metrics and durable internal alerts without exposing PII in
logs or metric labels.

Provide an admin-only packaged runbook:

```sh
cocalc docs show admin/crm --include-admin
cocalc docs search "customer relationship CRM" --include-admin
cocalc docs skill-context --query "institutional customer CRM" --include-admin
```

`cocalc admin crm --help` must show these commands and the preview/commit/fresh
auth workflow.

## Rollout Plan

### Phase 0: Legacy Removal And Contracts

- Delete the old `.cocalc-crm` editor, file registration, generic query code,
  and the seven empty legacy table definitions.
- Drop the seven empty production tables and remove the unused integer CRM
  columns from receivables.
- Confirm unrelated `crm_*` reporting schemas remain intact.
- Finalize the domain model and ownership classification.
- Define Conat types and stable CLI JSON schemas.
- Add packaged admin documentation and feature flags.
- Record rollout and rollback procedures for the new implementation.

Exit criterion: no production code references the abandoned editor or seven
legacy tables, and the unrelated `crm_*` schemas still pass their tests.

### Phase 1: Schema, Service, And CLI

- Add normalized seed-global tables and audit events.
- Implement seed-routed `adminCrm` APIs.
- Implement complete CLI reads and preview-first mutations.
- Add fresh-auth, idempotency, optimistic concurrency, redaction, and audit
  tests.
- Add customer discovery/backfill and diagnostics commands.

Exit criterion: an agent can perform all core organization, people,
opportunity, task, note, and linking workflows from CLI without UI or raw SQL.

### Phase 2: Customer 360 And Integrations

- Add Admin -> Customers queue and detail page.
- Integrate receivables organization/person selectors and timelines.
- Link site licenses and Stripe customer references.
- Add Zendesk ticket links and on-demand redacted thread access.
- Add bounded customer metric projections.

Exit criterion: CLI and UI expose equivalent operations backed by the same API,
and a customer page answers the primary operational questions.

### Phase 3: Customer Backfill And Production Rollout

- Run candidate backfill in staging and review every merge class.
- Validate multibay routing and projection behavior.
- Enable read-only production visibility.
- Review and commit production backfill in bounded batches.
- Enable mutations for a small admin cohort, then all admins and agents.

Exit criterion: new institutional tickets and commercial orders are linked to
canonical customers, and diagnostics contain no unexplained critical gaps.

### Phase 4: Operational Refinement

- Add renewal and expansion queues.
- Add deterministic follow-up reminders and daily digests.
- Improve customer metrics and duplicate detection.
- Consider additional integrations only when they preserve the authority
  boundaries in this plan.

## Testing Strategy

### Unit And Contract Tests

- Organization/domain normalization and conflict detection.
- Opportunity stage transition validation.
- Task state and due-date invariants.
- Merge rewrite plans and cycle prevention.
- Event idempotency and activity supersession.
- Stable CLI JSON contracts and bounded output.
- Exact UI/CLI parity against the same API surface.

### Security Tests

- Non-admin and impersonated access rejection.
- Agent capability allowlist behavior.
- Fresh-auth rejection and approved-cookie success.
- Preview without mutation and explicit `--commit` effects.
- Optimistic concurrency conflicts and safe refresh/retry.
- PII redaction, export audit, and payload-size limits.
- Rejection of card/bank data and unrestricted provider payloads.

### Integration Tests

- Link a Zendesk ticket without copying its conversation.
- Create an adoption opportunity and convert it into a commercial order.
- Provision and link a site license while preserving independent collection
  state.
- Link a Stripe customer and detect conflicting customer ownership.
- Merge duplicate organizations and rewrite all reviewed references.
- Re-run every command with the same idempotency key and verify no duplicate
  effect.

### Multibay Tests

- Run CRM commands through non-seed bays and verify seed authority.
- Link accounts and projects owned by different bays.
- Restart/rehome bays during reads and idempotent retries.
- Verify Customer 360 never performs unbounded synchronous cross-bay scans.

### Legacy Removal And Backfill Tests

- The cleanup removes exactly the seven abandoned tables and is idempotent.
- Unrelated `crm_*` schemas and read models remain available.
- No `.cocalc-crm` editor or direct legacy mutation route remains registered.
- New CRM UUID references integrate with commercial orders without legacy
  integer conversion.
- Customer discovery/backfill preview is deterministic, bounded, and safely
  restartable.
- Re-running a committed backfill batch does not duplicate customers, people,
  links, opportunities, tasks, or activities.

### End-To-End Agent Acceptance

On Lite with Stripe test mode and a test Zendesk integration, an agent must be
able to:

1. Search for a customer by domain.
2. Request and obtain fresh authentication.
3. Create or update the customer with preview/commit.
4. Link a Zendesk ticket and CoCalc contact.
5. Create an adoption-pilot opportunity and follow-up task.
6. Convert the accepted opportunity to a commercial order.
7. Create/send a test invoice and provision a site license through the existing
   receivables workflow.
8. Read the complete customer timeline and current commercial state from CLI.
9. Retry operations without duplicate records or side effects.
10. Perform the same supported operations in the admin UI.

## Feature Flags And Rollback

Use independent site settings for:

- CRM visibility
- CRM core mutations
- opportunity/task mutations
- Zendesk linking
- receivables/site-license integration
- metric projections
- customer discovery/backfill

All effectful flags default off. Rollback disables writes and integrations while
leaving read-only visibility and diagnostics available. Removal of the unused
legacy editor and empty tables is permanent cleanup and does not require a
compatibility or rollback mode.

## Definition Of Done

The CRM is complete when:

- every institutional customer has one reviewable canonical record;
- Zendesk, Stripe, receivables, site licenses, accounts, and opportunities are
  linked without duplicating their authoritative state;
- all supported functionality is available through documented
  `cocalc admin crm` commands;
- every UI action has CLI parity;
- agents can safely request fresh auth and complete workflows without raw SQL
  or browser automation;
- writes are preview-first, idempotent, versioned, fresh-authenticated, and
  audited;
- customer search and Customer 360 are bounded and multibay-correct;
- the unused Zendesk replacement, generic CRM tables, and `.cocalc-crm` editor
  are removed;
- packaged admin documentation explains normal operation and recovery;
- staging and Lite end-to-end tests demonstrate ticket-to-customer-to-order-to-
  invoice-to-license continuity.
