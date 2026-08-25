# CRM Outreach Implementation Plan

Date: 2026-08-25

Status: proposed implementation plan.

## Executive Decision

CoCalc should add a narrow, first-party outbound outreach workflow under:

```sh
cocalc admin crm outreach
```

CoCalc CRM remains the system of record for the prospect, contact,
opportunity, draft, approval, suppression state, delivery workflow, and audit
history. Zendesk remains the authoritative two-way conversation system.

Sending an outreach message creates one proactive Zendesk ticket per prospect:

- the reviewed CRM contact is the Zendesk requester;
- a CoCalc Zendesk agent is the submitter;
- the opening message is a public ticket comment;
- a shared CoCalc support address is the sender and reply path;
- the ticket is tagged and routed to a dedicated Partnerships/Sales view;
- the stable Zendesk ticket ID is linked to the CRM person, organization, and
  opportunity;
- replies remain visible to every support employee in Zendesk and appear as
  bounded events in the CRM timeline.

This is intentionally not a generic email campaign system. It supports
reviewed, conversational business outreach such as adoption-pilot offers,
renewal discussions, and expansion opportunities. It does not send directly
through CoCalc's SendGrid or SMTP delivery path in the first release. Direct
delivery without a first-class inbound mailbox would recreate threading,
reply handling, attachments, shared ownership, bounce processing, and message
visibility that Zendesk already provides.

The implementation is CLI-first. Every read, draft, review, queue, pause,
retry, suppression, reconciliation, and diagnostic operation must be usable by
agents through CoCalc CLI with the same behavior as the admin UI.

## Relationship To The Integrated CRM Plan

This plan is a deliberate, narrow amendment to
`integrated-crm-implementation-plan-2026-08-24.md`.

That plan correctly deferred generic CRM email sending, inbox synchronization,
marketing automation, lead-nurturing sequences, and bulk campaigns. Those
items remain deferred. This plan adds only proactive Zendesk conversations
whose recipients are individually represented by reviewed CRM people and
commercial opportunities.

System authority remains separated:

- CRM owns target selection, templates, rendered drafts, approvals,
  suppressions, queue state, and outreach audit history.
- Zendesk owns the customer-facing ticket, public comments, attachments,
  email notification behavior, requester replies, and ticket status.
- CoCalc tasks own internal follow-up.
- CoCalc opportunities own the possible commercial outcome.
- Site settings own feature gates, provider configuration, and rate limits.

Do not copy full Zendesk threads into CRM tables. Store the exact opening
message snapshot because CoCalc created it, then retain only bounded reply and
status metadata in the CRM timeline. Fetch the current redacted thread on
demand through the existing admin support APIs.

## Why This Is Needed

Today an employee can initiate a prospect conversation from a personal company
email address, but that creates avoidable operational failures:

- other employees cannot reliably see the conversation;
- a reply may wait in one employee's mailbox;
- ownership and the next action are not connected to the opportunity;
- there is no shared record of who was contacted or what was offered;
- duplicate outreach is easy when more than one person works the same account;
- agents cannot safely perform the workflow through CoCalc CLI;
- delivery volume is not governed by a shared, reviewable limit;
- opt-outs and hard bounces are not represented in the CRM.

Zendesk already solves the hard communication problems. CoCalc should connect
its CRM workflow to Zendesk instead of implementing another help desk or shared
mailbox.

## Goals

- Initiate one-to-one prospect communication from CoCalc CRM.
- Support small, explicitly reviewed batches of similar outreach.
- Use a shared company identity rather than an employee's private mailbox.
- Keep the full public conversation visible in Zendesk.
- Link every outreach conversation to a CRM organization, person, opportunity,
  and owner.
- Make drafts and exact rendered messages visible before sending.
- Make every effectful operation preview-first, fresh-authenticated,
  idempotent, bounded, and audited.
- Enforce global, hourly, daily, per-domain, per-contact, and per-batch safety
  limits using durable seed data.
- Make all rate limits easy for admins to change in site settings without a
  restart.
- Honor suppression, cooldown, and duplicate-conversation rules before queueing
  and again immediately before provider submission.
- Treat provider timeouts and retries without creating duplicate Zendesk
  tickets.
- Reconcile prospect replies against the existing shared follow-up task against the existing shared follow-up task.
- Surface My Read Receipts view observations on the exact outreach message in
  CRM UI, CLI, and the customer timeline.
- Create a shared, assigned no-response follow-up task for every sent outreach
  message, due after a reviewed and configurable interval.
- Provide complete UI and CLI parity.
- Work correctly in one-bay Launchpad and multibay Rocket.

## Non-Goals

- Replace Zendesk or synchronize an employee mailbox.
- Build a general marketing automation platform.
- Send newsletters, product announcements, drip sequences, or automated
  nurture campaigns.
- Automatically send reminder or follow-up messages. The first release flags
  due work, but a human reviews and sends every follow-up through Zendesk.
- Purchase or enrich contact lists.
- Infer recipient addresses from domains and send without human review.
- Automatically write messages using AI or send AI-generated text without
  human approval.
- Automatically advance opportunity stages based on email events.
- Claim that Zendesk ticket creation proves final email delivery or human
  reading.
- Implement a new first-party tracking pixel, employee surveillance, or
  conversation scoring. CoCalc only imports the bounded view observations that
  the existing My Read Receipts Zendesk integration already records.
- Fall back to direct SendGrid/SMTP delivery when Zendesk is unavailable.
- Build enterprise sales territories, quotas, or generalized approval policy.

## Core Invariants

1. One outreach delivery has exactly one reviewed organization, person,
   primary email relation, and optional opportunity.
2. A batch never sends one message with multiple unrelated prospects in `To`,
   `Cc`, or `Bcc`. Each prospect gets a separate Zendesk ticket.
3. The exact recipient, subject, body, footer, template revision, and commercial
   values are snapshotted before approval.
4. Approved content is immutable. Changes create a revision or replacement
   delivery.
5. A send commit only queues durable work. It does not perform a synchronous
   loop of external Zendesk calls.
6. The delivery worker checks feature flags, suppression, cooldown, and rate
   limits immediately before every effectful provider call.
7. A provider call that may have succeeded but lost its response is
   `indeterminate`; it is reconciled before retrying.
8. Zendesk ticket creation means `notification_requested`, not proven email
   delivery.
9. Suppressions cannot be bypassed by a normal send override. A separately
   audited suppression revocation is required.
10. Disabling outreach delivery prevents new provider calls while preserving
    drafts, queue state, audit history, and diagnostics.
11. Full Zendesk comments remain Zendesk-authoritative and are fetched on
    demand.
12. No outbound provider credential or webhook secret appears in CLI output,
    logs, CRM metadata, or browser state.
13. A My Read Receipts event is named `view_observed`, not `read` or
    `human_opened`. It is useful engagement evidence but not proof that a human
    read the message, because image proxies, previews, and security scanners can
    load tracking resources.
14. Every `notification_requested` outreach with a `no_response` follow-up
    policy creates exactly one linked task, initially task, initially waiting a snapshotted
   
    due time and owner. Queries and dashboards expose the task; they do not
   
    replace it.

## User Workflows

### Individual Adoption-Pilot Outreach

An agent starts from a reviewed organization such as `CRM-2026-000003`:

1. Select the active primary contact and adoption-pilot opportunity.
2. Choose the active adoption-pilot template or write a bounded custom draft.
3. Render the exact subject, body, price, service dates, signature, postal
   footer, and opt-out URL.
4. Preview contact evidence, existing Zendesk links, recent contact history,
   suppressions, cooldown status, and effective rate limits.
5. Approve the immutable snapshot.
6. Queue it with fresh authentication.
7. The worker creates a proactive Zendesk ticket and records the returned
   ticket ID.
8. CRM links the ticket and adds an append-only outreach activity.
9. CRM creates one assigned waiting follow-up task at the snapshotted due time.
10. A requester-reply webhook marks the delivery as replied and completes that
    waiting task.

### Reviewed Batch Outreach

A batch is a convenience for reviewing similar one-to-one messages. It is not
an unrestricted recipient query or generic campaign.

1. Create a named draft batch with an owner, purpose, and template revision.
2. Add organizations or opportunities explicitly, or import a bounded CRM view
   whose candidate rows are shown before they become recipients.
3. Resolve exactly one reviewed contact email per organization.
4. Render and inspect every message. Missing values, ambiguous contacts,
   suppressions, active outreach tickets, cooldown conflicts, and duplicate
   recipients are blocking errors unless the specific rule is explicitly
   overrideable.
5. Approve the batch. Approval stores each final message snapshot.
6. Queue all approved deliveries, subject to the configured batch maximum.
7. The worker submits messages gradually under the global and provider limits.
8. Pause or cancel the remaining queue without affecting Zendesk tickets that
   were already created.

### Replies And Follow-Up

- Zendesk remains the normal place to read and answer public replies.
- `cocalc admin support show <ticket>` displays the redacted thread.
- `cocalc admin support reply <ticket>` remains the authoritative CLI reply
  command. `cocalc admin crm outreach reply` may be an ergonomic wrapper, but
  it must call the same `adminSupport` operation rather than create a second
  comment implementation.
- CRM shows the linked ticket, current status, last public interaction time,
  and a bounded reply summary.
- The first requester reply completes the existing waiting `contact` task with
  outcome `response_received`; it does not create a duplicate task.
- No reply automatically changes an opportunity from discovery to qualified.

### View Observations

The existing My Read Receipts Zendesk integration records when an outbound
ticket comment appears to have been viewed. Import this as a first-class,
append-only engagement observation tied to the exact Zendesk ticket and comment.

For the opening outreach message:

- record the opening Zendesk comment ID when creating the proactive ticket;
- ingest the first and subsequent observed-view timestamps idempotently;
- project the first observation, latest observation, and observation count onto
  the delivery for efficient queue and Customer 360 display;
- append one concise `outreach_view_observed` CRM activity for the first
  observation and retain later observations in the engagement event history;
- expose the signal in `outreach show`, JSON output, queue filters, and the
  opportunity timeline;
- do not automatically advance the opportunity, complete a task, or claim that
  the recipient read the content.

Prefer My Read Receipts' structured Zendesk ticket-field storage when available.
If the installed configuration only emits private ticket comments, accept a
receipt only when the Zendesk comment author/integration identity matches the
configured My Read Receipts identity and the payload matches a versioned,
fixture-tested adapter. Never parse an arbitrary private note containing words
such as "seen" or "read".

Only retain the prospect email relation, ticket/comment correlation, observation
time, provider event key, and bounded provenance. Do not copy IP addresses,
browser/OS fingerprints, user agents, location, or tracking URLs into CRM.

### No-Response Follow-Up

Follow-up must be durable shared work rather than a query that an employee has
to remember to run.

Each outreach template defines a constrained follow-up policy:

- `no_response`, required for adoption-pilot, renewal, and expansion outreach;
- `none`, allowed only for explicitly reviewed informational outreach; and
- `follow_up_after_days`, an integer override snapshotted into every delivery.

If the template has no override, use the site-wide default. When a delivery
reaches `notification_requested`, atomically create one linked CRM task:

- type `contact`;
- state `waiting`;
- assignee equal to the opportunity owner, falling back to the organization
  relationship owner;
- due at `notification_requested_at + follow_up_after_days`;
- linked organization, person, opportunity, outreach delivery, and Zendesk
  ticket;
- subject such as `Follow up on adoption-pilot offer`.

Before the due time, it appears under **Waiting for response**. At or after the
due time, if no requester reply or opt-out has arrived, the same task becomes
due/overdue in the ordinary shared CRM task queue and the Outreach follow-up
view. Do not create a second task merely because the first became overdue.

A requester reply completes the waiting task idempotently and records
`response_received` in the completion activity in the completion activity. An opt-out or hard suppression
cancels it. Ticket closure without a requester reply does not silently complete
it; an employee must complete, cancel, or reschedule it with a reason. A view
observation does not complete or postpone it, but the due queue may distinguish
**view observed, no reply** from **no view observed**.

The first release never sends the follow-up automatically. The queue links to
the current redacted Zendesk thread and prints the existing
`cocalc admin support reply <ticket>` command. A later reviewed follow-up can be
recorded as another outbound comment and reschedules the same task from that
comment's notification time. Multi-step automated sequences remain out of
scope.

### Opt-Out

Every message includes a shared company identity, physical postal address, and
an opt-out URL. The URL uses a random opaque token whose digest is stored; it
does not expose CRM, person, or email identifiers.

An opt-out request:

- requires no CoCalc account;
- records an active email-level suppression immediately;
- cancels queued deliveries to the same normalized email;
- appends a bounded CRM activity;
- shows only a generic confirmation page;
- does not disclose whether other CRM records exist.

Employees can also record an opt-out, bounce, complaint, invalid address, or
organization-level do-not-contact request from UI or CLI. Free-form reply text
is not automatically interpreted as an opt-out in the first release; an agent
reviews the reply and records the suppression.

## Authority And Multibay Ownership

Outreach is cluster-global commercial state. All new outreach tables are
seed-authoritative:

```ts
{
  ownership: "seed-global",
  authority: "seed",
  portability: "stable",
}
```

Required behavior:

- All outreach reads, writes, queue claims, provider operations, webhook
  events, and suppressions route to seed authority.
- Launchpad follows the same code path with its only bay as seed.
- Account rehome and project moves do not move outreach records.
- A webhook accepted on a non-seed bay validates and forwards an idempotent
  event to seed authority.
- Only seed workers submit proactive Zendesk tickets.
- Browser and CLI calls use the seed-routed `adminCrm` service; they never
  mutate outreach tables directly.
- The worker does not synchronously query every bay while deciding whether to
  send.

## Domain Model

Define every durable table in `packages/util/db-schema`, import it from the
schema index, classify it in `table-ownership.ts`, and add it to the ownership
manifest tests. Do not create outreach tables ad hoc in service startup code.

### Outreach Templates

Suggested table: `crm_outreach_templates`.

Fields:

- `id` UUID
- `template_key` stable human selector, such as `adoption-pilot`
- `revision` positive integer
- `name`
- `kind`: `adoption_pilot`, `renewal`, `expansion`, or `other`
- `status`: `draft`, `active`, or `retired`
- `subject_template`
- `body_markdown_template`
- `required_fields` constrained text array
- `follow_up_policy`: `no_response` or `none`
- optional `follow_up_after_days` integer override
- `created_by_account_id`
- `created_at`
- `activated_by_account_id`, `activated_at`
- `retired_by_account_id`, `retired_at`

`(template_key, revision)` is unique. Activating a revision never mutates a
previous active revision's content. At most one revision per key is active.

Allowed merge fields are explicit and server-rendered. The first release may
include:

- person display and first name;
- organization display name;
- opportunity kind, expected value, currency, service start, and service end;
- relationship owner display name;
- customer number and opportunity identifier.

Do not support arbitrary SQL, JavaScript, property traversal, or unbounded
provider data in templates.

### Outreach Batches

Suggested table: `crm_outreach_batches`.

Fields:

- `id` UUID
- `outreach_number`, such as `OUT-2026-000123`
- `name`
- `purpose`
- `kind`
- `state`: `draft`, `approved`, `queued`, `sending`, `paused`, `complete`, or
  `cancelled`
- `template_id` and immutable template revision snapshot
- `owner_account_id`
- `recipient_count`
- `approved_recipient_count`
- `queued_at`, `started_at`, `completed_at`, `paused_at`, `cancelled_at`
- `created_by_account_id`, `approved_by_account_id`, `updated_by_account_id`
- `created_at`, `updated_at`
- `version`

An individual outreach is represented as a one-recipient batch so the worker,
audit, state, and CLI contracts remain identical.

### Outreach Deliveries

Suggested table: `crm_outreach_deliveries`.

Fields:

- `id` UUID
- `batch_id`
- `organization_id`
- `person_id`
- `person_email_id`
- optional `opportunity_id` and `task_id`
- immutable recipient name and normalized email snapshot
- immutable subject, plain-text body, rendered HTML, footer, and template
  revision snapshot
- `state`: `draft`, `approved`, `queued`, `creating_ticket`,
  `notification_requested`, `replied`, `closed`, `suppressed`, `failed`, or
  `cancelled`
- deterministic `provider_external_id`, for example
  `cocalc-crm-outreach:<delivery-uuid>`
- optional `zendesk_ticket_id`
- `opening_zendesk_comment_id`, `last_zendesk_comment_id`,
  `last_zendesk_status`, and bounded sync metadata
- projected `first_view_observed_at`, `last_view_observed_at`, and
  `view_observation_count`
- snapshotted `follow_up_policy`, `follow_up_after_days`,
  `notification_requested_at`, and `follow_up_due_at`
- `approved_at`, `queued_at`, `provider_submitted_at`, `replied_at`,
  `closed_at`, `cancelled_at`
- `next_attempt_at`, `attempt_count`, bounded `last_error`
- `created_by_account_id`, `approved_by_account_id`,
  `updated_by_account_id`
- `created_at`, `updated_at`
- `version`

Constraints and indexes:

- one delivery per `(batch_id, person_email_id)`;
- unique `provider_external_id`;
- unique non-null `zendesk_ticket_id`;
- queue claim index on `(state, next_attempt_at, id)`;
- organization/person/opportunity indexes for Customer 360;
- check constraints for every state and positive attempt count.

The exact rendered opening message is retained because it is a CoCalc-reviewed
commercial action. Later Zendesk replies are not copied in full.

### Contact Suppressions

Suggested table: `crm_contact_suppressions`.

Fields:

- `id` UUID
- scope: `email`, `person`, `organization`, or `domain`
- normalized scope value and optional CRM foreign keys
- reason: `opt_out`, `hard_bounce`, `complaint`, `invalid_address`, `manual`,
  `legal`, or `other`
- source: `opt_out_link`, `zendesk`, `provider`, `admin_ui`, or `cli`
- optional bounded source reference and note
- `active`
- `created_by_account_id`, `created_at`
- optional `revoked_by_account_id`, `revoked_at`, and revocation reason
- `version`

Active suppressions are unique per normalized scope. Suppression history is
never deleted when a person or organization is archived or merged. Domain and
organization suppressions require an additional warning because of their
scope.

### Provider Operations

Suggested table: `crm_outreach_provider_operations`.

Each effectful Zendesk call has a durable operation row:

- `id` UUID
- `delivery_id`
- operation: `create_ticket`, `add_comment`, or `reconcile_ticket`
- stable idempotency key and canonical payload hash
- state: `queued`, `started`, `succeeded`, `failed`, `indeterminate`, or
  `cancelled`
- attempt number
- provider external ID and optional Zendesk ticket ID
- rate-limit snapshot used for the attempt
- lease owner and lease expiry
- `not_before`
- bounded provider status, error category, and error text
- `created_at`, `started_at`, `finished_at`, `updated_at`

A timeout after an effectful request becomes `indeterminate`. Recovery searches
Zendesk for the deterministic `external_id` before retrying. A blind retry is
forbidden because it can send duplicate prospect messages.

### Webhook Inbox

Suggested table: `crm_outreach_zendesk_events`.

- immutable Zendesk event identifier
- Zendesk ticket and comment identifiers
- event type and occurred time
- minimal bounded event payload or a digest plus fetch cursor
- processing state, attempt count, next attempt, and last error
- received, processed, and dead-letter timestamps

Provider event ID is unique. The HTTP handler validates the Zendesk signature,
persists the event, and returns quickly. A seed worker fetches authoritative
ticket metadata and applies idempotent CRM activities.

### Outreach Engagement Events

Suggested table: `crm_outreach_engagement_events`.

Fields:

- `id` UUID
- `delivery_id`
- `kind`, constrained to `view_observed` initially
- `provider`, constrained to `my_read_receipts` initially
- stable `provider_event_id`, or a canonical digest when the provider supplies
  no event ID
- `zendesk_ticket_id` and `zendesk_comment_id`
- `observed_at` and `ingested_at`
- bounded provenance metadata containing parser/field-map version, but no IP,
  user-agent, browser, OS, location, or tracking URL

Provider event identity is unique. If no stable event ID exists, derive the
digest from provider, Zendesk ticket ID, Zendesk comment ID, normalized
observation timestamp, and the authenticated integration identity. The delivery
projection is rebuilt from these immutable rows and must never be the only copy
of the observations.

### Worker State

Use a small `crm_outreach_worker_state` table, keyed by provider, for durable
global backoff, provider `Retry-After`, reconciliation cursors, and worker
heartbeat. This is operational state, not the source of truth for individual
deliveries.

## State Machines

Batch transitions:

```text
draft -> approved -> queued -> sending -> complete
  |         |          |         |
  +------> cancelled <-+---------+
                       |
                    paused -> queued
```

Delivery transitions:

```text
draft -> approved -> queued -> creating_ticket -> notification_requested
  |         |          |              |                    |
  |         |          |              +-> indeterminate*   +-> replied -> closed
  |         |          +-> suppressed
  |         +-> cancelled
  +-> cancelled

queued/creating_ticket -> failed -> queued (reviewed retry)
notification_requested -> closed
```

`indeterminate` is represented in the provider operation while the delivery
remains blocked from a new call. Reconciliation resolves it to
`notification_requested` or a safely retryable failure.

No terminal or already-submitted delivery can be edited back into draft.

## Zendesk Adapter

Extend the existing server Zendesk client rather than creating a second
credential loader.

The proactive ticket payload should include:

```ts
{
  ticket: {
    external_id: `cocalc-crm-outreach:${delivery.id}`,
    requester: { name: delivery.recipient_name, email: delivery.email },
    submitter_id: configuredAgentId,
    recipient: configuredSupportAddress,
    subject: delivery.subject,
    comment: { public: true, body: delivery.body },
    group_id: configuredGroupId,
    ticket_form_id: configuredFormId,
    status: "pending",
    tags: [
      "cocalc_crm_outreach",
      `crm_${customerNumber}`,
      `outreach_${batch.outreach_number}`,
      delivery.kind,
    ],
  },
}
```

Normalize tags to Zendesk-safe values and keep sensitive CRM details out of
tags and public comments. The customer number and outreach number are safe
internal correlation keys; UUIDs remain in `external_id` and CRM.

Before production enablement:

- provision `partnerships@cocalc.com` as a standard Google Workspace mailbox,
  not a private employee mailbox, Google Group, or unsupported alias chain;
- add it to Zendesk as an external support address, automatically forward its
  inbound mail to the Zendesk-provided address, verify forwarding, and
  authorize Zendesk to send for `cocalc.com` through the required DNS email
  authentication;
- set the proactive ticket's `recipient` to that configured support address so
  customer notifications and replies use the shared identity;
- configure a Zendesk Partnerships/Sales group and view;
- verify that the proactive-ticket trigger sends a requester notification for
  an agent-created ticket with a public comment;
- verify that requester replies append to the same ticket;
- store and validate the configured group, form, submitter, and support address
  through diagnostics;
- use a Zendesk sandbox or controlled internal recipient for automated tests.

If Zendesk is disabled, misconfigured, rate limited, or unavailable, deliveries
remain queued or failed. Do not fall back to SendGrid, SMTP, AWS SES, or a
personal mailbox.

## Configurable Rate Limiting

Rate limiting must be visible and easily configurable under:

```text
Admin -> Site Settings -> Billing & Commerce -> CRM Outreach
```

Add typed settings in `util/db-schema/site-defaults.ts`, expose their effective
values through server settings, and document the equivalent fresh-auth CLI
configuration path through `cocalc admin settings set`.

Recommended settings and defaults:

| Setting                                 | Default | Validation         | Meaning                                                           |
| --------------------------------------- | ------: | ------------------ | ----------------------------------------------------------------- |
| `crm_outreach_enabled`                  |    `no` | boolean            | Show and allow outreach draft/read workflows.                     |
| `crm_outreach_mutations_enabled`        |    `no` | boolean            | Allow draft, approval, suppression, pause, and queue mutations.   |
| `crm_outreach_delivery_enabled`         |    `no` | boolean            | Emergency effectful Zendesk delivery switch.                      |
| `crm_outreach_webhook_enabled`          |    `no` | boolean            | Accept and process Zendesk outreach events.                       |
| `crm_outreach_max_recipients_per_batch` |    `25` | integer `1..500`   | Maximum approved recipients in one batch.                         |
| `crm_outreach_send_per_minute`          |     `5` | integer `1..60`    | Seed-global provider calls per rolling minute.                    |
| `crm_outreach_send_per_hour`            |    `50` | integer `1..1000`  | Seed-global provider calls per rolling hour.                      |
| `crm_outreach_send_per_day`             |   `200` | integer `1..5000`  | Seed-global provider calls per rolling 24 hours.                  |
| `crm_outreach_send_per_domain_per_day`  |    `20` | integer `1..500`   | Calls to one normalized recipient domain per rolling 24 hours.    |
| `crm_outreach_contact_cooldown_days`    |    `90` | integer `1..730`   | Default minimum interval between initiated outreach to one email. |
| `crm_outreach_default_followup_days`    |     `7` | integer `1..90`    | Default calendar-day wait before no-response follow-up is due.    |
| `crm_outreach_worker_concurrency`       |     `1` | integer `1..10`    | Maximum local effectful Zendesk calls in flight.                  |
| `crm_outreach_worker_batch_size`        |    `10` | integer `1..100`   | Maximum rows claimed per worker cycle.                            |
| `crm_outreach_retry_max_attempts`       |     `8` | integer `1..20`    | Maximum effectful/reconciliation attempts before dead letter.     |
| `crm_outreach_retry_base_seconds`       |    `60` | integer `10..3600` | Base for bounded exponential retry delay.                         |

Use separate settings for provider routing and required content:

- `crm_outreach_zendesk_submitter_id`
- `crm_outreach_zendesk_group_id`
- `crm_outreach_zendesk_form_id`
- `crm_outreach_zendesk_support_address`
- `crm_outreach_company_postal_address`
- `crm_outreach_footer_markdown`
- `crm_outreach_zendesk_webhook_secret` as a secret site setting rendered with
  the standard secret setting input.
- `crm_outreach_read_receipts_enabled`
- `crm_outreach_read_receipts_mode`, constrained to `ticket_fields` or
  `private_comments`
- the Zendesk ticket-field IDs used by the installed My Read Receipts
  configuration when `ticket_fields` mode is selected
- the expected My Read Receipts Zendesk integration/user ID when
  `private_comments` mode is selected

Configuration behavior:

- Settings are seed-global and reload without restarting the worker.
- The worker reads current limits before each claim cycle.
- Lowering a limit takes effect immediately for new claims.
- Raising a limit cannot exceed hard server safety bounds even if the stored
  site setting is malformed.
- `0` never means unlimited. Delivery is disabled using the explicit effectful
  feature flag.
- The admin UI shows both configured limits and current rolling usage.
- `cocalc admin crm outreach limits` returns configured limits, hard bounds,
  current counts, provider backoff, and the next eligible send time.
- Site-setting changes remain covered by the existing admin settings audit.
- The docs show safe CLI changes using a file so values do not appear in shell
  history:

```sh
printf '10\n' >/tmp/outreach-rate
cocalc admin settings set crm_outreach_send_per_minute \
  --value-file /tmp/outreach-rate
```

### Durable Enforcement Algorithm

Do not implement limits using only process memory. Multiple seed workers,
restarts, or deployment overlap must not multiply the allowed rate.

Before transitioning a delivery to `creating_ticket`, the worker uses one seed
transaction to:

1. acquire a stable advisory transaction lock for CRM outreach rate claims;
2. reload and validate effective settings;
3. verify all effectful feature flags;
4. check active suppressions and cooldown again;
5. count provider operations whose external effect may have started in the
   rolling minute, hour, day, and recipient-domain windows;
6. respect durable provider-wide `not_before` from Zendesk `Retry-After`;
7. claim one eligible delivery and insert its `started` provider operation;
8. snapshot the effective limits into operation metadata;
9. commit before making the external call.

Started, succeeded, and indeterminate calls count against the rate budget.
Calls proved to have failed before any request left CoCalc need not count. This
conservative rule prevents a timeout storm from bypassing limits.

Zendesk's own rate limit is an additional ceiling. On HTTP 429, persist the
provider `Retry-After` as a global backoff and stop claims until it expires.
Exponential retry uses jitter and never schedules beyond a configured bounded
maximum.

## Preflight And Suppression Rules

Preflight is deterministic and runs at recipient addition, preview, approval,
queueing, and final worker claim.

Blocking checks:

- organization, person, and person-email relations are active;
- the email relation is reviewed and marked verified;
- the email syntax and normalized domain are valid;
- no email, person, organization, or domain suppression applies;
- no same-purpose nonterminal outreach exists for the contact;
- no already-linked open Zendesk outreach ticket conflicts;
- required template values are present;
- opportunity value and service dates satisfy template requirements;
- rendered subject/body/footer are within bounded lengths;
- the opt-out link and postal address are present;
- recipient count is within the configured maximum;
- the delivery is not a duplicate in the same batch.

Warnings that may be explicitly overridden with a fresh-auth reason:

- contact cooldown has not elapsed;
- the organization had recent unrelated outreach;
- another active contact at the organization is already in the batch;
- the opportunity remains in discovery or has an unpriced value;
- the email domain is shared by multiple institutions.

An override is stored on the exact delivery and shown in preview. Suppression,
invalid identity, and missing required footer failures are never ordinary
overrides.

## Conat API

Extend the seed-routed `adminCrm` API with stable request and response types.

Reads:

- `listOutreachTemplates`
- `getOutreachTemplate`
- `listOutreachBatches`
- `getOutreachBatch`
- `listOutreachDeliveries`
- `getOutreachDelivery`
- `previewOutreachBatch`
- `listContactSuppressions`
- `getOutreachLimits`
- `getOutreachDiagnostics`
- `listOutreachEngagementEvents`
- `listOutreachFollowups`

Mutations:

- create/revise/activate/retire template
- create/update/cancel batch
- add/remove/render recipient
- approve batch or individual delivery
- queue/pause/resume/cancel batch
- retry or reconcile a failed/indeterminate delivery
- add/revoke suppression
- process a reviewed Zendesk reply association
- sync one linked Zendesk ticket
- reschedule or resolve a no-response follow-up through the shared CRM task
  transition service

Worker-only operations use a distinct seed-internal subject and capability.
Browsers and ordinary agent tokens cannot claim deliveries or write provider
results.

Every response follows the current CRM envelope with schema version,
provenance, redaction profile, bounded output, and stable machine-readable
errors.

## CLI Contract

Top-level help:

```text
cocalc admin crm outreach
```

Command families:

```text
cocalc admin crm outreach list|show
cocalc admin crm outreach draft
cocalc admin crm outreach preview
cocalc admin crm outreach approve
cocalc admin crm outreach queue
cocalc admin crm outreach pause|resume|cancel
cocalc admin crm outreach retry|reconcile
cocalc admin crm outreach batch create|add|remove|preview|approve|queue
cocalc admin crm outreach templates list|show|create|revise|activate|retire
cocalc admin crm outreach suppressions list|add|revoke
cocalc admin crm outreach followups list|show|reschedule|complete|cancel
cocalc admin crm outreach limits
cocalc admin crm outreach diagnostics
```

Representative individual flow:

```sh
cocalc admin crm outreach draft CRM-2026-000003 \
  --person tresham@hawaii.edu \
  --opportunity 681e04ca-a148-4565-910b-bfda4c47cacb \
  --template adoption-pilot \
  --reason "Prepare reviewed UH Hilo pilot outreach"

cocalc admin crm outreach preview OUT-2026-000123 --json

cocalc admin crm outreach approve OUT-2026-000123 \
  --expected-version 2 --idempotency-key <preview-key> \
  --reason "Reviewed recipient, offer, dates, and final message" --commit

cocalc admin crm outreach queue OUT-2026-000123 \
  --expected-version 3 --idempotency-key <preview-key> \
  --reason "Send approved adoption-pilot offer" --commit
```

CLI requirements:

- Mutations preview by default and require `--commit`.
- Preview shows the exact final recipient, subject, plain text, rendered body,
  footer, opt-out URL, Zendesk routing, warnings, suppressions, cooldown, and
  effective limits.
- `show` and stable JSON output include `first_view_observed_at`,
  `last_view_observed_at`, `view_observation_count`, the exact associated
  Zendesk comment ID, and a machine-readable confidence caveat.
- `followups list` supports due-before, overdue, assignee, organization,
  opportunity, viewed/unviewed, and replied/unreplied filters. It is an
  outreach-specific projection of ordinary CRM tasks, not a second task model.
- Follow-up rows include the exact `cocalc cocalc admin support show <ticket>` and
  `cocalc admin support reply <ticket> <ticket>` commands for the linked Zendesk ticket.
- `followups reschedule|complete|cancel` delegates to shared CRM task mutation
  semantics; add a generic task reschedule operation rather than editing due
  timestamps through an outreach-only shortcut.
- Approval and queue commits require cookie-backed fresh authentication,
  expected versions, idempotency keys, and immutable reasons.
- `queue --commit` returns after durable queueing; it does not wait for every
  Zendesk ticket.
- `--json` uses stable versioned schemas and never prints provider secrets.
- Human selectors are accepted for organization, person, opportunity,
  template, batch, and ticket. Ambiguity fails with bounded candidates.
- Batch recipient input from a file has a documented schema and a hard row
  limit.
- Reads and writes require audit reasons under the existing CRM policy.
- Existing `admin support show|reply` commands are linked prominently in
  outreach help.

Bundled help:

```sh
cocalc docs show admin/crm-outreach --include-admin
cocalc docs search "CRM outreach adoption pilot" --include-admin
cocalc docs skill-context --query "send reviewed prospect outreach" \
  --include-admin
```

## Authentication, Authorization, And Audit

- CRM outreach reads require admin or explicitly allowlisted agent
  capabilities and a human-readable audit reason.
- All writes require fresh authentication initially.
- Approval, queueing, retry, reconciliation, suppression revocation, template
  activation, and limit changes always require fresh authentication.
- Impersonated sessions, API keys, raw bearer-only sessions, and project-scoped
  credentials cannot perform outreach mutations.
- Agent authentication uses the existing browser-approved CLI bootstrap flow.
- Provider workers use internal capabilities unavailable to users.
- Every mutation records actor, reason, idempotency key, payload hash, result,
  and version.
- Every provider call records its exact bounded request digest, state, rate
  snapshot, and provider result reference.
- Never log full recipient lists or message bodies in ordinary service logs.
- Exports containing outreach content use the existing bounded sensitive CRM
  export controls.
- Do not build generalized CRM RBAC. Use operation-level capabilities suitable
  for CoCalc's small internal team.

## Admin UI

Add an **Outreach** tab under Admin -> Customers using the existing CRM visual
language.

### Queue

Show:

- draft, approved, queued, sending, paused, failed, replied, and completed
  counts;
- configured minute/hour/day/domain limits and current rolling consumption;
- Zendesk provider backoff and next eligible send;
- stale queued, failed, and indeterminate deliveries;
- waiting, due today, and overdue no-response follow-up counts;
- filters for owner, kind, batch, organization, opportunity, state, date, and
  Zendesk ticket;
- engagement filters for not observed, view observed, replied, and replied
  without a prior view observation;
- a visible delivery kill switch status and link to site settings.

### Draft And Review

The compose flow includes:

- organization, opportunity, and reviewed contact selectors;
- template and revision selector;
- server-rendered merge-field preview;
- exact per-recipient subject and message editing before approval;
- preflight warnings with clear remediation;
- recent CRM and Zendesk interaction summary;
- suppression and cooldown state;
- batch recipient table with search, filtering, and exclusion controls;
- a final immutable approval diff.

### Detail

The outreach detail page shows:

- batch owner, purpose, template, state, and version;
- every recipient and delivery state;
- exact approved opening message;
- provider attempts and actionable errors;
- linked organization, person, opportunity, task, and Zendesk ticket;
- last public interaction metadata and an on-demand redacted Zendesk thread;
- a clearly labeled **View observed** timestamp/count for the opening message,
  with a tooltip explaining proxy/scanner limitations;
- linked follow-up owner, due time, state, and reschedule/complete actions;
- pause, retry, cancel, suppress, and open-in-Zendesk actions;
- append-only outreach timeline.

Errors appear inside the active modal or action surface with a concise summary
and expandable technical details. Refresh clears stale mutation errors, matching
the CRM and receivables behavior.

Before implementing the UI, follow `src/.agents/accessibility.md`. All controls
must be keyboard operable, labeled, responsive, and covered by focused
accessibility tests. Do not make the batch table depend on horizontal scrolling
for primary actions.

## Zendesk Webhook And Reconciliation

Use an external webhook endpoint following the same architectural exception as
Stripe webhooks. It is not a browser or Next v2 business API.

Webhook processing:

1. Verify Zendesk signature and timestamp using a secret setting.
2. Reject oversized, stale, or malformed events.
3. Persist a minimal idempotent inbox row.
4. Return success without doing provider reads in the HTTP request.
5. Forward to seed authority if accepted by another bay.
6. Fetch current ticket metadata through the shared Zendesk client.
7. Match only tickets with the deterministic external ID and CRM link.
8. Append bounded activities for requester reply, staff reply, status change,
   closure, and authenticated My Read Receipts observations.
9. Correlate every observation to the exact outbound Zendesk comment; ignore
   uncorrelated or ambiguously parsed receipt notes.
10. Insert the immutable engagement event, rebuild delivery projections, and
    append the first-view CRM activity idempotently.
11. Complete the existing no-response follow-up task on the first requester
    reply; never create a duplicate response task.
12. Cancel the task on a verified opt-out or hard suppression.
13. Mark the inbox event processed or retry with bounded exponential backoff.

Run periodic reconciliation for all nonterminal outreach tickets so missed or
out-of-order webhooks do not permanently lose state. The reconciler uses a
bounded cursor, respects Zendesk rate limits, and does not copy full comment
bodies into CRM.

## Failure And Recovery Semantics

### Timeout During Ticket Creation

- Mark provider operation `indeterminate`.
- Do not immediately call create again.
- Search Zendesk for the deterministic external ID.
- If found, link the ticket and mark `notification_requested`.
- If definitively absent after bounded reconciliation, queue a new attempt.
- Surface unresolved indeterminate operations in diagnostics.

### Zendesk 429

- Parse `Retry-After`.
- Persist provider-wide backoff.
- Stop new claims until expiry.
- Keep queued rows intact.
- Show the backoff in UI and `outreach limits`.

### Zendesk Trigger Misconfiguration

Ticket creation may succeed even when requester notification is disabled.
Therefore, state remains `notification_requested`, not `delivered`. Diagnostics
must validate the configured trigger and the release checklist must include an
end-to-end test with an internal recipient.

### Invalid Requester Or Provider Rejection

- Mark delivery failed with a human summary and expandable provider detail.
- Do not expose credentials or unrestricted provider payloads.
- Allow correction by creating a new reviewed person-email relation and a new
  delivery revision.
- Do not mutate the immutable approved recipient snapshot.

### Kill Switch Or Pause

- Stop new provider claims.
- Let already-issued calls finish and record their result.
- Do not delete provider operations or queued deliveries.
- Resume from durable state after review.

## Diagnostics And Operations

`cocalc admin crm outreach diagnostics` should report:

- feature flags and effective limits;
- configured Zendesk submitter, group, form, support address, and webhook state
  without secrets;
- rolling minute/hour/day/domain usage;
- provider backoff and worker heartbeat;
- queued age percentiles and oldest queued item;
- failed, indeterminate, and dead-letter counts;
- duplicate external IDs or Zendesk ticket links;
- missing CRM activities or external references;
- active outreach tickets without an organization/person/opportunity link;
- replied tickets without an open or completed follow-up task;
- sent outreach missing its required waiting follow-up task;
- overdue no-response follow-ups grouped by owner and age;
- duplicate follow-up tasks for one delivery;
- active suppressions and recently blocked deliveries;
- templates with invalid required fields or no active revision;
- approved content missing the required footer or opt-out token;
- webhook event backlog, retries, and dead letters;
- stale Zendesk reconciliation cursors.
- read-receipt mode and configured field/integration identities without
  secrets;
- uncorrelated, ambiguous, malformed, or duplicate My Read Receipts events;
- deliveries whose engagement projections disagree with immutable events.

Add structured metrics for queue depth, claim latency, provider latency,
success/failure/indeterminate rates, 429s, suppressions, replies, and webhook
lag. Logs use stable IDs and bounded error categories rather than full messages.

## Documentation

Add an admin-only packaged page at `packages/docs`:

```text
/app-docs/admin/crm-outreach
```

It must explain:

- authority boundaries between CRM and Zendesk;
- one-recipient and batch workflows;
- preview/approve/queue semantics;
- fresh-auth CLI operation;
- configured rate limits and safe changes;
- suppression and opt-out handling;
- Zendesk setup and proactive notification trigger;
- pause, retry, reconciliation, and diagnostics;
- the meaning of `notification_requested`;
- the meaning and limitations of `view_observed`;
- no-response task creation, due/overdue queues, rescheduling, and human-reviewed
  Zendesk follow-up;
- My Read Receipts ticket-field/private-comment configuration and diagnostics;
- why there is no direct SendGrid fallback;
- incident response and emergency delivery shutdown.

Link this page from CRM Outreach UI and `cocalc admin crm outreach --help`.
Include examples in CLI builds so agents can operate without repository access.

## Rollout Plan

### Phase 0: Contracts And Zendesk Setup

- Finalize states, types, CLI JSON schemas, and audit actions.
- Configure a Zendesk sandbox or controlled test group, form, submitter, shared
  address, tags, and proactive requester-notification trigger.
- Inspect the installed My Read Receipts configuration and choose structured
  ticket fields where available; otherwise capture sanitized private-comment
  fixtures and pin the expected integration identity.
- Define provider adapter and fake provider contracts.
- Add site settings with all effectful flags defaulting to `no`.
- Exit criterion: exact internal-recipient proactive ticket flow is documented
  and manually verified.

### Phase 1: Schema, Read APIs, Drafts, And CLI

- Add all tables to `util/db-schema` and ownership manifest.
- Add shared types to `util/crm` and Conat API contracts.
- Implement templates, drafts, rendering, preflight, suppression, and read
  APIs.
- Implement complete CLI read and draft/preview operations.
- Add diagnostics with no provider effects.
- Exit criterion: an agent can create, render, approve, inspect, and cancel a
  one-recipient draft entirely through CLI.

### Phase 2: Durable Zendesk Delivery

- Implement provider operations, worker claims, durable rate limiting, retries,
  and deterministic external ID reconciliation.
- Add individual queue/pause/resume/cancel/retry CLI operations.
- Test against fake Zendesk and then a controlled internal Zendesk recipient.
- Keep maximum recipients per batch at `1` during the initial canary.
- Exit criterion: retries and simulated timeouts cannot create duplicate
  tickets.

### Phase 3: Replies, Receipts, Follow-Up, And Suppressions

- Implement signed webhook ingestion and periodic reconciliation.
- Add reply and view-observation activities.
- Create waiting no-response tasks after successful proactive ticket creation
  and complete/cancel them deterministically on reply or suppression.
- Add opaque opt-out links and suppression management.
- Verify webhook replay, missed events, out-of-order comments, and opt-out race
  handling.
- Exit criterion: a controlled recipient can reply and opt out with all state
  visible in Zendesk, CRM UI, and CLI.

### Phase 4: Admin UI

- Add Outreach queue, compose/review, detail, rate status, and diagnostics.
- Add Customer 360 outreach card and person-level suppression controls.
- Add bundled human and agent documentation links.
- Run frontend lint and focused accessibility coverage.
- Exit criterion: UI and CLI have equivalent supported operations against the
  same APIs.

### Phase 5: Small Batches And Production Canary

- Enable batches first for internal addresses, then a maximum of `5` reviewed
  real prospects.
- Verify shared Zendesk visibility, replies, rate displays, suppressions, and
  task creation.
- Raise `crm_outreach_max_recipients_per_batch` gradually through site settings
  after reviewing diagnostics.
- Keep default minute/hour/day/domain limits conservative.
- Exit criterion: at least one adoption-pilot conversation completes end to end
  without private employee email and without duplicate or untracked messages.

## Testing Strategy

### Unit Tests

- State transition validity.
- Follow-up policy validation, due-time snapshots, and owner fallback.
- Template field allowlist and deterministic rendering.
- Exact immutable snapshots and revision behavior.
- Email/domain normalization and deduplication.
- Suppression precedence and revocation.
- Cooldown and override rules.
- Rate-setting validation and hard bounds.
- Rolling window and per-domain calculations.
- Retry delay, jitter, and `Retry-After` parsing.
- Zendesk payload normalization and tag safety.
- Opt-out token digest and constant-time lookup.
- Stable CLI envelopes and error remediation.

### Database And Concurrency Tests

- Table constraints, foreign keys, and ownership manifest completeness.
- Two workers cannot exceed one shared rate budget.
- Two queue commits cannot create duplicate deliveries.
- Concurrent provider claim and opt-out leaves no post-opt-out provider call.
- Provider result replay cannot create duplicate no-response tasks.
- Reply, opt-out, task reschedule, and due processing races converge on one
  valid task state.
- Indeterminate operation blocks blind retry.
- Batch pause prevents later claims.
- Setting limits lower during a run immediately stops new claims.
- Webhook replay and out-of-order events remain idempotent.
- My Read Receipts field and authenticated private-comment fixtures produce the
  same canonical `view_observed` event.
- Arbitrary human private notes, malformed receipts, duplicate receipts, and
  observations for unrelated comments are ignored and diagnosed.
- Delivery first/latest/count projections rebuild exactly from engagement
  events.
- Customer/person merges retain suppression and delivery references.

### Provider Integration Tests

- Successful proactive ticket creation.
- Existing requester and newly created requester behavior.
- Public opening comment and configured group/form/address.
- Deterministic external ID lookup after simulated timeout.
- 400/401/403/404/409/429/5xx classification.
- Zendesk 429 global backoff.
- Requester reply and staff reply reconciliation.
- Trigger-disabled test proves the UI does not claim delivery.

### Security Tests

- Admin and allowlisted agent capability enforcement.
- Fresh-auth rejection for queue and suppression mutations.
- Impersonated, API-key, bearer-only, and project-scoped rejection.
- Secret redaction in API, UI, CLI, logs, and exports.
- Template injection and HTML sanitization.
- Oversized body, recipient file, and webhook rejection.
- Forged, stale, replayed, and malformed webhook rejection.
- Opt-out token enumeration resistance.
- Cross-organization selector and merge safety.

### End-To-End Acceptance On Lite/Staging

Using a fake Zendesk adapter or sandbox:

1. Create an organization, person, reviewed email, and adoption opportunity.
2. Create and activate an adoption-pilot template.
3. Draft and preview a one-recipient outreach entirely through CLI.
4. Approve and queue with fresh authentication.
5. Observe configured rate status before and after the worker claim.
6. Verify exactly one Zendesk ticket and CRM external reference.
7. Replay the provider result and webhook without duplicate activity.
8. Verify the initial message created one waiting CRM follow-up task, then move
   time beyond its due date and verify it appears in CLI and UI overdue views.
9. Simulate My Read Receipts for the opening comment and verify CLI, UI, and
   timeline show **View observed** with the correct caveat.
10. Reply as the prospect and verify the existing follow-up task completes.
11. Opt out and verify later queue attempts are suppressed and waiting follow-up
    is cancelled.
12. Lower the site rate to one per hour and prove a second delivery waits.
13. Disable delivery and prove queued state remains intact.
14. Complete the same supported operations from the admin UI.

Do not send real external prospect mail from Lite, staging, or automated CI.

## Feature Flags And Rollback

Parent dependencies:

- `crm_visible` must be enabled for outreach reads.
- `crm_mutations_enabled` must be enabled for outreach drafts and suppressions.
- `crm_zendesk_linking_enabled` must be enabled for provider ticket links.

Outreach-specific flags:

- `crm_outreach_enabled`
- `crm_outreach_mutations_enabled`
- `crm_outreach_delivery_enabled`
- `crm_outreach_webhook_enabled`

All default off. Rollback order:

1. Disable effectful delivery.
2. Pause queued batches.
3. Disable webhook processing only if event ingestion is unsafe; otherwise keep
   it on so replies remain visible.
4. Disable outreach mutations while retaining read-only records and
   diagnostics.
5. Leave existing Zendesk tickets operational in Zendesk.

Never delete or rewrite sent outreach during rollback.

## Definition Of Done

The CRM outreach system is complete when:

- all supported operations are usable through `cocalc admin crm outreach`;
- individual and batch sends are preview-first and queue durable work;
- rate limits are seed-global, database-enforced, visible, and editable by
  admins in site settings without restart;
- disabling delivery stops new provider effects immediately;
- deterministic reconciliation prevents duplicate proactive tickets after
  timeouts;
- every sent opening message has a reviewed organization, person, email,
  opportunity, owner, and immutable snapshot;
- every Zendesk ticket is linked and visible from CRM Customer 360;
- requester replies create bounded CRM activity and actionable follow-up;
- every sent adoption/renewal/expansion outreach creates exactly one assigned,
  snapshotted no-response task that is visible before and after its due time and
  resolved deterministically by reply or suppression;
- My Read Receipts observations are correlated to exact outbound comments,
  retained as immutable bounded engagement events, and clearly surfaced as
  non-authoritative **View observed** signals in CRM UI and CLI;
- suppressions and opt-outs reliably stop future outreach;
- Zendesk remains authoritative for full public conversation content;
- no workflow requires a personal employee mailbox, browser automation, raw
  SQL, or an unexposed endpoint;
- CLI and UI share the same Conat APIs and exact safety semantics;
- packaged docs explain normal operation, limits, failure recovery, and
  emergency shutdown;
- Lite/staging tests demonstrate rate limiting, retries, replies, opt-out, and
  duplicate prevention end to end.
