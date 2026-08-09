# Growth and Retention Analytics Implementation Plan

Date: 2026-08-04

Last updated: 2026-08-09

Status: approved; minimum fast release slice implemented, staging validation
pending

Revision notes for 2026-08-09:

- incorporate the durable, consent-gated active-user location history merged in
  PR #244 and the related seed-authoritative collection work;
- reuse the new versioned UX traces for signed-in bootstrap, project entry,
  directory paint, file open, Jupyter, terminal, LaTeX, upload, and Codex;
- account for site-funded Codex now being available to free as well as paid
  CoCalc-ai users;
- make first-project and Codex-guided activation explicit product experiments,
  not merely future dashboard ideas.

Implementation progress for 2026-08-09:

- added the versioned event contract, bounded privacy-safe ingestion API,
  canonical account profiles/milestones/daily facts, restart-safe materializer,
  dirty-period repair, and compact metric/retention/weekly serving tables;
- persisted a per-bay canonical coverage boundary so legacy accounts may count
  toward post-launch activity without being misrepresented as new signup or
  retention cohorts;
- replaced `/admin/retention` request-time scans with one bounded dashboard RPC
  over serving tables, including freshness, backlog, definition, coverage, and
  partial-period labels;
- added canonical semantic instrumentation for account creation/verification,
  project creation/visible surface, foreground engagement, editor/terminal/
  Jupyter work, and AI prompt submission without recording user content;
- added focused validation for payload rejection, activity semantics, serving
  queries, idempotent schema creation, duplicate delivery, durable watermarks,
  and restart-safe materialization;
- retained the active-user location snapshots as a separate regional-adoption
  series rather than mislabeling them as canonical retention;
- implemented a versioned, account-home-persisted first-run flow on the Projects
  page for invitation acceptance, prepared projects, personal/team/site access,
  Jupyter, SageMath, terminal/code, LaTeX, teaching, and user-initiated Codex;
- made RootFS selection site-configurable through documented
  `onboarding:*` catalog tags, retained advanced project creation as an escape
  hatch, and removed the legacy automatic empty-project creation race;
- preserved course scope/context for both email-only and existing-account
  invitations, and added bounded browser analytics for onboarding exposure,
  project-create start, readiness, entry, completion, and abandonment;
- deferred pre-account anonymous funnel events, provider delivery webhooks,
  experiment assignment, unit economics, multibay global aggregate publication,
  and historical legacy-proxy backfill to subsequent phases. The schema and
  event vocabulary reserve these extensions without putting them on the
  `/admin/retention` request path.

## Objective

Implement a durable, privacy-conscious product analytics system that lets
SageMath, Inc. answer, quickly and reproducibly:

- How many people are using CoCalc meaningfully?
- Are active users, activation, and retention improving over time?
- Which acquisition sources produce retained users rather than only signups?
- Where do users leave the signup and activation funnels?
- How long does each step from sign-in to visible, usable project work take, and
  how strongly do latency and failures predict abandonment?
- Which product changes improve retention and growth?
- Are changes caused by acquisition mix, seasonality, product quality, or an
  experiment?
- What does it cost to serve each product and user population, and where is the
  next discrete capacity cost?
- Can a guided first-project experience and Codex-assisted first task convert
  more new accounts into self-directed, retained users?

The first user-visible requirement is that `/admin/retention` becomes fast and
stays fast as CoCalc accumulates years of history and orders of magnitude more
users.

## Executive Decision

Do not optimize the current request-time analytics SQL. Replace it.

The target architecture has four layers:

1. A small, versioned product-event contract records meaningful actions.
2. An idempotent materializer converts events into compact account/day facts and
   account milestones.
3. Background workers maintain bounded aggregate serving tables.
4. `/admin/retention` reads only the serving tables, never raw logs, accounts,
   projects, or activity-event tables.

This makes dashboard cost proportional to the number of plotted points, not to
the number of users or historical events.

## Implemented Baseline as of 2026-08-09

Several capabilities described abstractly in the original plan now exist. The
new analytics system should reuse them deliberately rather than create parallel
definitions.

### Durable Active-User Location History

PR #244 and its prerequisite work added:

- `active_user_map_history_snapshots` and
  `active_user_map_history_countries`;
- seed-authoritative hourly collection for trailing 60-minute and 1,440-minute
  active windows;
- complete cross-bay collection with transient account-id deduplication;
- country-level persistence only, with no account ids or precise locations in
  historical rows;
- consent-gated country counts plus explicit mapped, unknown-location, and
  consent-not-enabled totals;
- indefinitely retained history by default, daily and hourly serving APIs, and
  map/plot playback in the admin UI.

This is already a useful, compact global serving product for regional adoption
and broad active-population trends. It must remain distinct from canonical
growth retention:

- its active definition is based on `accounts.last_active`, not
  `project_engaged_v1` or `project_work_v1`;
- its 24-hour value is a rolling window, not a UTC DAU fact or a retention
  cohort cell;
- country series include only consenting mapped accounts, while `total_active`
  intentionally has broader operational semantics;
- it contains no account-level history and therefore cannot calculate
  retention, activation, resurrection, or acquisition quality.

The growth dashboard should link to or read this existing aggregate for a
clearly labeled regional-adoption panel. Do not copy it into account/day facts,
attempt to infer cohorts from it, or silently label it canonical DAU. Its
completeness metadata and seed-authoritative convergence pattern are good models
for global growth aggregate publication.

### Retention-Critical UX Traces

Versioned browser-observed traces now cover important portions of time to
value, including:

- `signed_in_app_ready_v2` and `app_bootstrap_failed_v2`;
- project-open routing phases, `project_directory_first_paint_v2`,
  `directory_authoritative_paint_v2`, and
  `directory_listing_incomplete_v2`;
- file content paint, edit readiness, sync readiness, and incomplete opens;
- Jupyter document readiness, first visible cell, sync readiness, first output,
  completed/no-op/failed/incomplete runs;
- terminal input readiness and failed/incomplete connections;
- upload completion/failure/abandonment and LaTeX build completion/failure;
- Codex backend acknowledgement, first visible response, failure, and
  incompletion.

The shared `UxLatencyTrace` adds deterministic success sampling, records
failures and incomplete traces without sampling, rejects hidden/stale surfaces,
correlates events with system-pressure context, and avoids awaiting telemetry in
the user action. These are substantial improvements over treating generic web
usage as product intent.

However, `ux_latency_events` remains audit-local operational telemetry. It may
contain sampled successes, is not account-home authoritative, and is optimized
for recent diagnosis rather than permanent semantic facts. Therefore:

1. use v2 traces as source evidence for latency, reliability, and funnel-step
   outcomes;
2. inverse-probability weight sampled aggregate success metrics by
   `1 / sample_rate`, while displaying the actual sampled row count;
3. never interpret the absence of a sampled success as user inactivity;
4. emit a separate unsampled, rate-limited semantic event when a trace endpoint
   must set a canonical account milestone or daily activity bit;
5. materialize only bounded outcome classes and latency buckets/percentiles,
   not trace details, project ids, or pressure payloads, into long-term growth
   facts.

### Email-First Signup and Attribution

Production signup is now email-first and password-optional, with email proof and
account completion presented as one flow. This makes `auth_started`,
`email_delivery_requested`, `identity_proved`, `account_created`, and
`profile_completed` real funnel boundaries rather than inferred states. The
existing expiring `analytics` link still provides landing/referrer/UTM context,
so immutable attribution snapshotting at account creation remains urgent.

Email code is the dominant successful proof method. Code and link remain
separate `auth_method` values for diagnostics, but product decisions should
optimize total identity-proof completion and elapsed time rather than assume
link usage is inherently desirable.

### Site-Funded Codex for Every Membership Tier

CoCalc-ai now makes bounded site-funded Codex available to free and paid users,
using GPT-5.6 Luna with global/free/paid pool controls, per-turn reservations,
provider-cost accounting, and a kill switch. A new user can therefore receive
agentic help in their real project without first buying a subscription,
supplying an API key, or connecting an external ChatGPT account.

This changes Codex from an optional advanced feature into a viable activation
surface. Growth facts must snapshot the funding/eligibility class at exposure
time and separately measure:

- offer shown and accepted;
- funded-turn admission, denial, failure, and interruption;
- backend acknowledgement and first visible response latency;
- onboarding completion;
- continued or self-directed work after the guided interaction;
- provider cost per assisted activation and retained user.

Never put prompts, responses, filenames, or generated content in growth data.

## Performance and Correctness SLOs

The implementation is not complete unless it satisfies all of these:

| Property                                        | Target                                              |
| ----------------------------------------------- | --------------------------------------------------- |
| Cold backend response for the default dashboard | p95 below 250 ms                                    |
| Warm backend response                           | p95 below 100 ms                                    |
| Admin page interactive after navigation         | below 1 second under normal conditions              |
| Dashboard query timeout                         | 5 seconds, replacing the current 120 seconds        |
| Query dependence on total event/account count   | none                                                |
| Current-day data freshness                      | normally below 15 minutes                           |
| Finalized prior-day data                        | normally complete by 00:30 UTC                      |
| Worker restart behavior                         | automatically resumes and converges                 |
| Duplicate delivery                              | no double counting                                  |
| Late event behavior                             | affected periods are recomputed automatically       |
| Metric reproducibility                          | every result identifies a metric-definition version |

## Current System and Why It Is Slow

The current page is implemented by:

- `src/packages/frontend/admin/retention-overview.tsx`
- `src/packages/server/membership/retention-overview.ts`
- RPC types and handlers currently placed in the purchases API

For every uncached request, the server currently:

- scans `ux_latency_events` or `account_cpu_usage_events` over the requested
  window;
- joins event rows to `accounts`;
- optionally performs correlated existence checks against
  `account_project_index`;
- computes distinct accounts per bucket;
- generates all cohort-period combinations;
- joins distinct account activity into exact and rolling cohort counts;
- groups the expanded result;
- relies on a 60-second, process-local LRU to hide repeated work.

This has several structural problems:

- Request latency grows with raw event volume and history.
- A hub restart discards the cache.
- Multiple hubs independently perform the same expensive work.
- Operational telemetry is being treated as a product metric because it happens
  to exist.
- `ux_latency_events` describes latency samples, not a canonical definition of
  an active user.
- managed CPU can be generated by unattended or idle processes.
- `account_project_index.last_activity_at` and `accounts.last_active` retain only
  the latest value and cannot produce exact historical return behavior.
- changing a metric definition silently changes the meaning of the historical
  graph.

The older `crm_retention` implementation has a different but related problem:
it incrementally stores arrays derived from arbitrary raw tables. It should not
become the new foundation.

## Product Metric Contract

Metric definitions must be product decisions, not incidental SQL predicates.
Definitions live in source control, are versioned, and are shown in the admin
UI.

### Eligibility

The default human-account population is:

- a completed account;
- a verified email identity or a trusted verified SSO identity;
- not ephemeral;
- not a known test account;
- not a staff/admin account when measuring customer growth;
- not banned or classified as abusive automation.

The dashboard must permit explicit comparison with broader populations, but its
default headline metrics use this eligible population. Exclusions are recorded
as dimensions so a change to classification can trigger recomputation rather
than silently rewriting history.

### Funnel Milestones

Record the first occurrence of these milestones when applicable:

| Milestone                  | Meaning                                                                  |
| -------------------------- | ------------------------------------------------------------------------ |
| `landing_seen`             | An attributable visitor loaded a CoCalc landing page.                    |
| `auth_started`             | The visitor began an SSO, email, or password auth flow.                  |
| `email_delivery_requested` | CoCalc accepted an email challenge for delivery.                         |
| `email_delivered`          | The email provider confirmed delivery, when webhooks are configured.     |
| `identity_proved`          | Email code/link or SSO proved control of the identity.                   |
| `account_created`          | Durable account creation completed.                                      |
| `profile_completed`        | Required post-verification account setup completed.                      |
| `first_project_flow_seen`  | The first-project entry point or guided wizard was visibly presented.    |
| `project_create_started`   | The account deliberately submitted its first project creation.           |
| `project_created`          | The account created its first project.                                   |
| `project_ready`            | The first project reached a usable runtime state.                        |
| `project_entered`          | The account deliberately entered a ready project.                        |
| `project_surface_visible`  | Its initial directory or requested work surface visibly rendered.        |
| `first_meaningful_work`    | The account performed its first high-intent project action.              |
| `first_ai_prompt`          | The account submitted its first AI prompt.                               |
| `guided_activation_done`   | The account completed the bounded guided first-task experience.          |
| `first_self_directed_work` | Meaningful work occurred after completing or dismissing onboarding.      |
| `first_collaboration`      | The account participated in a project with another person.               |
| `first_purchase`           | The account first completed a paid purchase or received paid membership. |

These milestones support conversion-time distributions as well as conversion
rates. For example, the dashboard should show median and p90 time from account
creation to first meaningful work.

Failures and abandonment are not milestones. Record allowlisted funnel outcomes
such as `project_create_failed`, `project_ready_timeout`,
`project_surface_incomplete`, `codex_admission_denied`, and
`guided_activation_abandoned` in the short-lived event log and materialize
aggregate rates. Keep the milestone table monotone and earliest-occurrence
only.

### Activity Signals

Use several named signals rather than pretending all activity is equivalent.

#### `app_foreground_v1`

An authenticated CoCalc application was visible and foregrounded long enough to
send a rate-limited presence event. This is intentionally weak and useful mainly
for comparison with conventional DAU numbers.

#### `project_engaged_v1`

The user deliberately opened a project and either:

- kept it foregrounded for at least 60 seconds; or
- performed a `project_work_v1` action.

Automatic tab restoration, background websocket reconnects, and server-side
project processes do not count on their own.

#### `project_work_v1`

A high-intent action occurred, such as:

- execute a notebook cell;
- submit input to a terminal;
- create, edit, or save a file;
- submit an AI prompt;
- start a user-requested computational task.

Only the action category is recorded. Never record terminal input, code, file
paths, prompts, notebook content, or outputs.

#### `compute_consumed_v1`

The account consumed a nontrivial amount of attributed managed CPU. This remains
a secondary operational/product signal because unattended computation can
continue without a present user.

#### `ai_engaged_v1`

The user submitted an AI prompt or continued an AI interaction. Loading an old
AI session does not count.

#### `self_directed_work_v1`

The account performed `project_work_v1` after the first-project/Codex onboarding
surface was completed, dismissed, or had not been shown for an applicable
reason. An automatically submitted onboarding prompt, agent-generated file, or
background agent turn does not count.

This signal prevents a Codex onboarding treatment from mechanically improving
its own success metric merely by causing the event used to define activation.

### Default Active User Definition

The default headline active-user metric is distinct eligible accounts with
`project_engaged_v1` during the period.

The dashboard should expose `project_work_v1`, `app_foreground_v1`,
`compute_consumed_v1`, `ai_engaged_v1`, and `self_directed_work_v1` as
comparisons. The label must always say which definition is selected; avoid a
bare, ambiguous label such as "activity."

### Activation

The default activation metric is:

> An eligible newly created account records `first_meaningful_work` within 24
> elapsed hours of account creation.

Also report activation within 1 hour, 7 days, and 30 days. Project creation alone
is not activation because projects may be created automatically or abandoned
without use.

For onboarding experiments, report assisted activation and self-directed
activation separately. The primary success metric for a Codex-guided treatment
should normally be `first_self_directed_work` within 24 hours, with D1/D7
`project_work_v1` retention as a maturity check. Do not use the guided prompt
itself as the sole primary outcome.

### Time-to-Value and Reliability

Activation rate without experienced performance can hide the mechanism of a
loss. Materialize bounded attempt/outcome and latency distributions for:

- signed-in browser to usable projects page;
- first-project create submission to durable project row;
- project entry to routing resolved, runtime ready, first directory paint, and
  authoritative directory paint;
- file open to visible content and edit/sync readiness;
- Jupyter open to visible document and first executable result;
- terminal open to input readiness;
- Codex prompt to admission, backend acknowledgement, and first visible
  response.

For each step show attempt count, success, explicit failure, incomplete/timeout,
p50, p90, and p95. Correlate duration buckets with next-step conversion and
activation, but do not retain arbitrary trace payloads in growth facts. Preserve
trace version, sampling coverage, browser visibility validity, and source
confidence so instrumentation changes create visible boundaries.

### Retention

Use exact UTC calendar-period retention as the primary definition:

- D0 is the UTC date containing account creation.
- D1 is meaningful activity on the next UTC date.
- D7 is meaningful activity on the seventh UTC date after creation.
- Weekly cohorts begin Monday 00:00 UTC.
- W1 is meaningful activity during the next complete UTC week.

Show these separately:

- exact-period retention: active in exactly Dn or Wn;
- cumulative activation: reached a milestone by Dn or Wn;
- rolling retention: active in period n or any later observed period, with the
  observation horizon displayed.

Do not label "ever active after D7" as D7 retention. The current page's "later"
value may remain only if explicitly named rolling retention.

Incomplete periods are null, not zero.

### Growth Accounting

For each complete week, classify active eligible accounts as:

- new: first-ever meaningful activity occurred this week;
- retained: active this week and the immediately preceding week;
- resurrected: active this week, inactive in the preceding week, but active
  earlier;
- churned: active in the preceding week but not this week.

This provides a more useful growth equation than signup count alone:

`net active growth = new + resurrected - churned`

Also report DAU, WAU, MAU, DAU/WAU, WAU/MAU, and matched weekday/week-over-week
changes.

## Attribution and Segmentation

At account creation, copy normalized first-touch attribution from the existing
`analytics` record into an immutable growth profile. Do not make long-term
metrics depend on the expiring analytics cookie row.

Initial acquisition channels should be a stable allowlist:

- direct/unknown;
- Google organic;
- other organic search;
- SageMath properties;
- AI assistant referral;
- other referral;
- paid campaign;
- institutional or course invite;
- collaboration/share invite;
- registration token;
- legacy migration.

Normalize landing URLs into route groups such as `homepage`, `signup`,
`jupyter`, `sage`, `latex`, `feature`, `pricing`, `public_share`, and `other`.
Do not retain arbitrary query strings or unbounded paths in analytics facts.

Initial supported dashboard segment sets should be deliberately bounded:

- overall;
- acquisition channel;
- landing-page group;
- auth method;
- legacy versus genuinely new;
- institutional versus consumer email classification;
- experiment and variant;
- membership tier at activity time;
- region, using a coarse non-PII classification if available.

Do not implement arbitrary SQL-like combinations of dimensions. Precompute a
small allowlist of useful segment sets to avoid a combinatorial aggregate cube
and small-cohort privacy leaks.

## Data Model

Names below are recommended. Exact SQL types may change during implementation,
but grain, authority, and uniqueness must not.

### `growth_account_profiles`

One account-home authoritative row per account.

Important fields:

| Field                                      | Purpose                                                                         |
| ------------------------------------------ | ------------------------------------------------------------------------------- |
| `account_id`                               | Primary key.                                                                    |
| `home_bay_id`                              | Explicit authority and routing.                                                 |
| `created_at`, `cohort_date`, `cohort_week` | Stable cohort assignment.                                                       |
| `verified_at`                              | Identity-verification completion.                                               |
| `auth_method`                              | `email_code`, `email_link`, SSO provider class, password, invite, or migration. |
| `acquisition_channel`                      | Canonical first-touch channel.                                                  |
| `landing_group`                            | Canonical landing route.                                                        |
| `campaign`                                 | Sanitized bounded campaign identifier, if present.                              |
| `legacy_status`                            | Legacy-linked, migrated, or genuinely new.                                      |
| `institution_class`                        | Coarse domain classification without storing the email address.                 |
| `actor_class`                              | Customer, staff, test, ephemeral, suspected automation.                         |
| `onboarding_eligibility`                   | New, legacy, invited, course-managed, or other bounded onboarding class.        |
| `codex_entitlement_at_creation`            | Site-funded free/paid, user-funded, unavailable, or unknown.                    |
| `excluded_from_growth`                     | Current default-population exclusion.                                           |
| `exclusion_reason`                         | Bounded enum.                                                                   |
| `definition_version`                       | Profile-classification version.                                                 |
| `created_at_source`                        | Source confidence/backfill marker.                                              |
| `updated_at`                               | Maintenance timestamp.                                                          |

Mutable classifications such as banned status may change. A profile update must
enqueue affected periods for aggregate repair.

### `growth_account_milestones`

One row per account and milestone.

Recommended primary key:

`(account_id, milestone, definition_version)`

Fields include `occurred_at`, `source_event_id`, `home_bay_id`, and
`metadata_class`. An insert uses `ON CONFLICT` with the earliest timestamp, so
retries and out-of-order delivery converge.

### `growth_account_activity_daily`

One row per account and UTC day.

Recommended primary key:

`(account_id, activity_date)`

Fields include:

- `home_bay_id`;
- `metric_contract_version`;
- explicit boolean or small-integer columns for `app_foreground`,
  `project_engaged`, `project_work`, `self_directed_work`, `compute_consumed`,
  and `ai_engaged`;
- earliest and latest meaningful activity timestamps for the day;
- membership/product tier snapshot;
- source confidence;
- `updated_at`.

This is a boolean fact, not a raw click counter. Upserting signal columns from
false to true and updating minimum/maximum timestamps is naturally idempotent.
One row per active account/day is substantially smaller than one row per signal
and is compact enough to retain for the life of the product. A contract version
defines the meaning of all signal columns; a semantic change starts a new
contract version and visible coverage boundary instead of rewriting history.

Required indexes include `(activity_date, account_id)`,
`(account_id, activity_date DESC)`, and only the partial signal indexes proven
necessary by background materialization. Interactive dashboard queries do not
read this table.

### `growth_event_log`

A short-lived, partitioned, append-only event log supports debugging, funnel
analysis, definition repair, and experiment analysis.

Fields include:

- globally unique `event_id`;
- `event_name` and `event_version`;
- `occurred_at` and `received_at`;
- nullable `account_id` for authenticated events;
- nullable pseudonymous visitor id for pre-account funnel events;
- `home_bay_id`, source bay, and source component;
- optional experiment/variant;
- a tightly validated, size-limited property object.

Default raw retention should be 90 days. Monthly partitions make expiration a
partition operation instead of a large row-by-row delete. Daily facts,
milestones, and aggregates remain after raw events expire.

No source code, prompts, filenames, URLs with query strings, email addresses,
IP addresses, or arbitrary client payloads are allowed.

Operational UX traces are an ingest source, not a second event contract. A
bridge may translate allowlisted v2 trace endpoints into bounded growth outcomes
and latency buckets. It must understand `sample_rate`, trace version, stale or
hidden classifications, and audit-local source authority. Canonical account
activity still requires its own unsampled semantic event.

### `growth_materialization_state`

Durable worker progress, including:

- worker name and scope/bay;
- source watermark;
- latest successfully finalized hour/day/week;
- metric-definition version;
- last success, duration, rows processed, and error;
- lease owner and lease expiry where needed.

No in-memory watermark is authoritative.

### `growth_dirty_periods`

A deduplicated repair queue keyed by metric version, scope, grain, and period.
Late events, profile classification changes, attribution corrections, and
definition repair add rows here. Workers claim rows with `FOR UPDATE SKIP
LOCKED`, recompute the complete period, and delete the queue row transactionally.

### Aggregate Serving Tables

Use separate tables with explicit schemas rather than one opaque JSON cache.

#### `growth_metric_series`

Stores bounded day/week/month series such as:

- funnel counts and conversion rates;
- signups and verified accounts;
- activation counts;
- DAU/WAU/MAU;
- stickiness ratios;
- milestone latency percentiles;
- first-project and guided-onboarding attempts, outcomes, abandonment, and
  latency percentiles;
- Codex funded admission, response visibility, assisted activation,
  self-directed activation, and provider cost;
- AI engagement;
- paid conversion.

Recommended key dimensions are `scope_id`, `metric_name`, `metric_version`,
`period_grain`, `period_start`, `segment_set`, and `segment_value`.

#### `growth_retention_cells`

Stores exact and rolling cohort cells with:

- cohort grain and cohort start;
- activity signal and definition version;
- period index;
- cohort size;
- exact active accounts;
- rolling active accounts;
- maturity/finality state;
- segment set and value.

#### `growth_weekly_accounting`

Stores new, retained, resurrected, and churned counts for each complete week and
supported segment.

#### `growth_annotations`

Stores deployment, marketing, outage, pricing, signup-flow, and experiment
annotations. Graphs should display these so changes are interpreted in context.

## Unit Economics and Capacity Extension

Growth analytics and infrastructure economics share population definitions and
calendar periods, but they must not share an opaque fact table. Cost accounting
is a separate workstream with its own source confidence, allocation versions,
and serving tables. It must not delay the minimum fast replacement for
`/admin/retention`.

### Questions This Must Answer

- What is the actual provider cost of shared infrastructure by day, service,
  bay, region, and product?
- What are average cost per eligible MAU, engaged MAU, activated account,
  revenue-bearing seat, and direct subscription account?
- Which costs are directly attributable, usage-variable, continuously fixed, or
  fixed until the next regional capacity step?
- How much CPU, memory, disk, egress, AI, and other metered capacity is unused,
  and which resource will force the next purchase?
- What is the incremental cost of growth before the next capacity step, and
  what will the next step add per month?
- What are contribution margin and gross margin by product after refunds,
  provider cost, payment fees, and explicitly included support costs?

Never publish one unlabeled "cost per user" value. At minimum, show both a
fully allocated average and a marginal/headroom view, with the denominator and
included cost classes visible.

### Cost Classes

Every cost row must be assigned one of these bounded classes:

- `direct_metered`: attributable to one customer's VM, host, volume, AI usage,
  or another pay-as-you-go resource;
- `shared_variable`: varies approximately with usage, such as egress or API
  calls;
- `shared_fixed`: continuously required control-plane or storage cost;
- `regional_step`: a regional host or service that is fixed until another
  capacity unit is required;
- `internal`: staff, testing, staging, development, or research infrastructure;
- `unallocated`: known cost whose economic owner or allocation rule is not yet
  defensible.

Do not silently spread `unallocated` cost across customers. The unallocated
fraction is a data-quality metric.

Metered revenue and provider cost remain separate facts. For example, pricing a
resource at provider cost plus a 30% markup produces a 23.1% gross margin on
revenue before payment fees, support, refunds, taxes, and bad debt. Both markup
and margin should be displayed with explicit formulas.

### Cost Sources

Use two parallel sources:

1. provider billing exports or invoices provide authoritative, lagged net cost,
   including committed-use treatment, credits, discounts, and adjustments;
2. the live resource catalog and inventory provide an immediate estimate and
   capacity forecast.

Reconcile estimates to actual billing after provider data arrives. Preserve
both values and source timestamps rather than rewriting estimates invisibly.
Currency conversion, if needed, uses a recorded daily rate and never the
current rate for historical data.

### `economics_provider_cost_daily`

One row per UTC day and provider billing resource or defensible aggregate.
Fields include:

- provider, billing account, service, SKU, resource id, and resource class;
- bay, host, region, and funding mode where attributable;
- list cost, estimated effective cost, authoritative net cost, credits, and
  currency;
- usage quantity and unit;
- cost source (`catalog_estimate`, `billing_export`, or `invoice`), source
  timestamp, and reconciliation state;
- cost class, economic-principal class, and allocation eligibility;
- importer and schema versions.

Provider identifiers and customer economic-principal identifiers remain
backend-only. Admin serving APIs expose aggregates unless an audited operator
workflow explicitly requests detail.

### `economics_resource_usage_daily`

Compact daily resource facts keyed by resource scope and resource type. Record
only quantities needed for allocation and capacity planning:

- attributed CPU seconds and project runtime seconds;
- disk byte-hours and snapshot/backup byte-hours;
- ingress and egress bytes;
- AI/provider usage and direct provider cost where already metered;
- host provisioned CPU, memory, and disk;
- p50, p95, and peak host utilization, pressure, running projects, and admission
  denials;
- product, membership, site-license, funding-mode, region, and economic-
  principal snapshots.

The economic principal is the entity funding service: direct subscription
account, institutional/site-license contract, customer-funded metered resource,
free shared service, or internal use. It is not necessarily the person who
performed an action in a collaborative project.

Do not query raw CPU events or host telemetry interactively. Materialize these
facts incrementally and retain daily aggregates. Account-level detail follows
the same account-home and privacy rules as growth facts.

### `economics_capacity_daily`

One row per host or regional capacity pool and day, containing provisioned and
used CPU, memory, disk, I/O, project slots, and relevant pressure metrics. Store
the limiting resource, configured threshold, estimated headroom, estimated date
or load at exhaustion, candidate next capacity unit, and its monthly cost.

This table supports the economically important distinction between:

- near-zero incremental infrastructure cost while safe headroom exists;
- degradation risk as a resource approaches a threshold; and
- the discrete monthly cost of adding the next host or disk increment.

### `economics_revenue_daily`

Recognize recurring membership and site-license revenue over the covered
period rather than only on purchase dates. Record metered revenue, credits,
refunds, taxes, payment fees, and bad debt separately. Keep product and economic-
principal classes bounded and versioned so annual plans and institutional
contracts can be compared fairly with monthly infrastructure cost.

### `economics_allocation_daily`

Stores reproducible allocated results, never the only copy of source costs.
Each result identifies:

- cost date and source cost class;
- product, segment, region, and economic-principal class;
- direct, allocated, and unallocated cost;
- allocation basis and quantity;
- allocation-rule version;
- source coverage and finality.

Recommended initial allocation rules are:

1. assign metered resources and provider APIs directly where a funding entity
   is authoritative;
2. allocate shared disk and backup cost by disk byte-hours;
3. allocate shared compute cost by attributed CPU seconds, while reporting the
   continuously running regional floor separately;
4. allocate control-plane cost by eligible engaged-account days;
5. leave unsupported or ambiguous costs unallocated.

Allocation rules are management views, not accounting truth. Changing a rule
creates a new version and preserves prior results for comparison.

### Economics Serving Metrics

Precompute bounded day/week/month series for:

- actual and estimated infrastructure cost by class and product;
- cost per eligible MAU, engaged MAU, activated user, paid equivalent seat, and
  direct subscription account;
- contribution margin by product and acquisition cohort;
- average versus marginal cost per active user;
- metered-resource markup and gross margin;
- regional utilization, headroom, capacity-cliff cost, and time to threshold;
- cost concentration percentiles without exposing individual customer data;
- estimated-versus-actual reconciliation error and unallocated-cost fraction.

Expose these on a dedicated `/admin/economics` page and link to it from the
growth dashboard. `/admin/retention` may show only a small headline economics
summary so cost collection cannot compromise its latency SLO.

### Observed Baseline and Missing Data, 2026-08-05

This is an operational snapshot, not a durable budget:

- 13 shared regional `t2d-standard-16` spot hosts provide 208 vCPUs;
- their catalog-estimated compute and persistent-disk cost is approximately
  $1,905/month, of which about $632/month is disk;
- two additional site-funded project hosts add approximately $376/month, for a
  known project-host floor near $2,280/month;
- the shared hosts averaged about 14.2% host CPU over the sampled 24 hours,
  while their data devices were about 71.4% full in aggregate and several were
  above 80%; storage and regional placement are therefore at least as important
  as fleet-wide average CPU;
- current account activity is approximately 1,281 DAU, 4,484 WAU, and 10,793
  MAU, making the 13-host shared pool about $0.18 per MAU-month before control
  plane, database, backups, egress, Cloudflare, email, observability, support,
  payment, and other company costs;
- dividing that pool only by the 177 direct subscribed accounts yields about
  $10.76/month, but this is not cost per paid user because institutional
  contracts, site-license seats, free users, and internal use are not yet
  represented by a common economic-principal model;
- even a one-day aggregate scan of `account_cpu_usage_events` exceeded a
  25-second production statement timeout, confirming that daily resource facts
  are required rather than more request-time SQL;
- no queryable provider billing ledger, daily resource-cost fact, cost-allocation
  version, revenue accrual fact, or compact fleet-capacity series currently
  exists in the admin data system.

The current defensible statement is therefore a lower bound: known site-funded
project-host infrastructure is approximately $0.21 per MAU-month. A fully
loaded cloud-infrastructure or company cost per user cannot yet be stated
honestly from available data.

## Event Collection

### Event Envelope

Add a shared typed contract under `@cocalc/conat` with:

- an allowlisted event name;
- schema version;
- globally unique event id;
- occurred timestamp;
- authenticated account id supplied by the server, never trusted from browser
  input;
- project id only where needed for routing, not long-term dashboard output;
- safe bounded dimensions;
- source component.

Reject unknown properties and oversized payloads. Do not provide a generic
"track arbitrary JSON" API.

### Reliable Sources

Prefer server-observed events for:

- email challenge requested/proved/completed;
- account creation and verification;
- project creation;
- purchases and memberships;
- collaboration changes;
- AI prompt submission;
- managed compute attribution;
- site-funded Codex admission, reservation outcome, and provider cost.

Use browser or project-host events where the server cannot infer intent:

- project foreground duration;
- user-initiated project entry;
- notebook cell execution;
- terminal input submission;
- editor modification/save.

Reuse the existing v2 UX trace endpoints for experienced latency and explicit
failure/incomplete outcomes. Do not add a second browser timer for the same
workflow. At the trace endpoint, emit or enqueue a separate small semantic event
only when canonical account activity or a milestone must be set, regardless of
whether the diagnostic success trace was sampled.

Browser events are best effort and rate limited. Important project-data-plane
events should be accepted by a narrow project-host analytics subject and sent
asynchronously; they must not route project content through the hub.

### Rate Limiting and Deduplication

- Presence emits at most once per account per hour while foregrounded.
- Project engagement emits at most once per account/project per bounded session.
- Work-action events may be collapsed by category and short time window.
- The first canonical work signal per account/day is never success-sampled;
  later repetitions may be collapsed.
- UX success samples retain their `sample_rate`; failure, timeout, and
  incomplete outcomes remain unsampled and are never reweighted.
- Event ids are stable across retry.
- Daily fact upserts are idempotent even if the same semantic activity arrives
  more than once.
- Analytics failure never blocks the user action.

## Multibay Architecture

The system must follow `src/.agents/scalable-architecture.md` from the first
implementation.

### Authority

- `growth_account_profiles`, milestones, and account daily facts are
  account-home authoritative.
- Authenticated activity is routed by `account_id -> home_bay_id`.
- Anonymous pre-signup events remain local until linked to an account; their
  long-term output is aggregate only.
- Raw diagnostic event logs are bay-local and short lived.
- Each bay computes aggregate rows only for accounts whose home is that bay.

### Cross-Bay Project Activity

A project may be owned by a different bay from the acting account's home bay.
The project host or owning bay must:

1. authenticate the actor from the scoped project session;
2. write a durable local outbox event;
3. route the small analytics event to the actor's home bay over internal Conat;
4. retry until acknowledged;
5. deduplicate by event id at the home bay.

Steady-state files, terminal streams, and notebook traffic remain direct between
the browser and project host. Analytics does not become a data-plane proxy.

### Global Admin View

Each home bay publishes only aggregate serving rows to a small global analytics
projection. Summing is exact because each account belongs to exactly one home
bay. The global layer never needs account ids for dashboard reads.

Published rows remain bay-scoped and are replaced idempotently, not applied as
untracked count deltas. Account rehome must dirty the affected source and target
bay periods so an account cannot be counted by both homes.

Launchpad runs the same path with a single bay and local dispatch.

## Materialization and Convergence

### Incremental Loop

Run the materializer every five minutes:

1. Acquire a Postgres advisory lock or renewable DB lease for the bay/scope.
2. Read from the durable watermark with an overlap window.
3. Upsert milestones and daily account facts.
4. Mark affected UTC days and cohorts dirty.
5. Recompute dirty aggregate rows transactionally.
6. Advance the watermark only after successful commit.
7. Record health and release the lease.

Multiple hubs may start the loop. Database coordination ensures only one worker
owns a scope at a time.

### Repair Loop

- Recompute the current day and preceding three UTC days every run.
- Recompute the previous 35 days nightly.
- Recompute affected older periods from `growth_dirty_periods`.
- Finalize periods only after the accepted late-arrival window.
- Provide an admin/CLI command to rebuild a date range and metric version.

After a control-plane restart, another process acquires the lease, reads the
stored watermark and dirty queue, and continues. There is no startup-only task
whose interruption can leave analytics permanently stale.

### Health Monitoring

Expose and alert on:

- watermark lag;
- oldest dirty period age;
- event ingest failures;
- rejected event count by reason;
- materialization duration and row count;
- aggregate repair failures;
- global replication lag;
- source-to-fact reconciliation mismatch.

The admin page should show a small data-health banner with coverage start,
definition version, last materialization time, and whether the latest period is
partial.

## Fast Dashboard API

Create a dedicated growth analytics Conat API instead of adding more analytics
methods to the purchases API.

Recommended methods:

- `getGrowthSummary`
- `getGrowthFunnel`
- `getActiveUserSeries`
- `getRetentionMatrix`
- `getWeeklyGrowthAccounting`
- `getGrowthSegments`
- `getGrowthDataHealth`
- `createGrowthAnnotation`
- `rebuildGrowthAnalyticsRange` as a fresh-auth admin operation

All read methods:

- require admin authorization;
- validate a bounded time range and allowlisted dimensions;
- query only aggregate serving tables;
- return metric definition and coverage metadata;
- suppress segment cells below the privacy threshold;
- support `ETag`-like revision values or a `materialized_at` cache key;
- return bounded result sets.

One page load should require no more than four parallel indexed queries. A
single combined overview RPC is acceptable if it remains typed and internally
reads the same serving tables.

## `/admin/retention` Replacement

Replace the existing controls and graphs rather than preserving accidental
definitions.

### Overview

Show headline cards with matched-period comparison:

- completed eligible signups;
- verification/account-completion conversion;
- activated accounts and activation rate;
- DAU, WAU, and MAU using `project_engaged_v1`;
- WAU/MAU;
- weekly retained and resurrected users;
- optional paid conversion.

### Acquisition and Activation

Show:

- signup trend by canonical channel;
- funnel from attributable landing through meaningful work;
- median/p90 time to identity proof and activation;
- first-project exposure, create submission, durable creation, runtime readiness,
  visible project surface, and meaningful-work conversion;
- experienced p50/p90/p95 time through signed-in bootstrap, project creation,
  project entry, and first visible work surface;
- Codex offer, admission, first visible response, assisted activation,
  self-directed activation, and cost per outcome;
- activation rate by channel, landing group, and auth method;
- retained users by source, not only raw signup volume.

Add a regional-adoption link or panel backed by the existing
`active_user_map_history_*` aggregates. Label its 60-minute/1,440-minute rolling
`last_active` definition and consent coverage explicitly; do not combine it
with canonical DAU or retention cells.

### Retention

Show:

- daily and weekly cohort heatmaps;
- exact D1/D7/D14/D30 or W1/W2/W4/W8 retention;
- optional rolling retention clearly labeled;
- selectable activity signal;
- cohort size and maturity;
- comparison against preceding cohorts.

### Active Growth

Show:

- DAU/WAU/MAU history;
- matched weekday and week-over-week changes;
- stacked weekly new/retained/resurrected users;
- churned users as a separate negative series;
- stickiness ratios;
- annotations for releases, incidents, campaigns, and experiments.

### Segment Safety

Default to the eligible human population. Require an explicit control to include
staff, test, ephemeral, banned, or unverified accounts. Suppress segment cells
with fewer than 20 accounts by default.

### UX Behavior

- Load a useful default overview immediately.
- Fetch independent panels in parallel and render progressively.
- Keep the previous data visible during filter changes.
- Display cached aggregate data if the materializer is delayed, together with
  its age.
- Remove the 120-second request timeout.
- Permit aggregate CSV export without account-level rows.

## Activation Product Program

Analytics is useful only if it supports concrete product changes. The first two
high-priority interventions should address the observed losses before first
project creation and before first useful work.

These flows need durable product state separate from analytics. A user must be
able to reload, change device, or return later without corrupting the wizard.
Growth events describe exposure and outcomes; they must never become the source
of truth that controls which UI the account sees.

### Intervention A: Guided First Project

Hypothesis:

> A focused first-project wizard will reduce the large account-to-project loss
> by removing an unfamiliar blank-project decision and carrying the user through
> a visibly usable directory.

Eligibility should initially require all of:

- a genuinely new eligible account;
- no existing or previously created project;
- no collaboration, course, registration-token, public-share copy, or explicit
  post-auth destination that already determines what should happen;
- no completed or dismissed first-project onboarding state.

Legacy users and users arriving through an invite should follow their intended
destination rather than be intercepted by generic onboarding. Mobile may use a
simplified treatment or remain out of the first experiment until it is tested.

The minimal wizard should:

1. ask one bounded intent question such as notebook/data science, mathematics,
   terminal/Linux, LaTeX, course work, or something else;
2. recommend a project name and RootFS/template while keeping advanced resource
   and region settings out of the critical path;
3. submit one idempotent create request and show durable provisioning progress;
4. survive reload and resume from authoritative project/LRO state;
5. enter the project automatically when ready and remain present until the
   first directory or requested surface is visibly rendered;
6. offer an obvious skip and preserve normal advanced project creation.

The RootFS/template recommendation is part of the experiment definition and
must be versioned. Never infer wizard success from a project row alone: record
exposure, start, submit, create success/failure, runtime ready, first visible
surface, completion, skip, and timeout. Use the existing project-open and
directory v2 traces for timing, plus unsampled semantic milestones for durable
conversion.

Primary outcome: `project_surface_visible` within 15 minutes of account
creation. Secondary outcomes: project creation, elapsed time to visible surface,
`first_meaningful_work` and `first_self_directed_work` within 24 hours, and D1/D7
project-work retention. Guardrails: create/start failure, p95 time to surface,
duplicate projects, support contacts, unexpected spend, and invite/deep-link
regressions.

### Intervention B: Codex-Guided First Task

Hypothesis:

> Once a new user can see a project, a short Codex-guided task in that real
> environment will demonstrate CoCalc's value and teach the next action better
> than a passive product tour.

This is now economically feasible because bounded site-funded Luna is available
to free users. The experience should begin only after
`project_surface_visible`; it must not compete with project startup or hide a
failure behind chat.

Offer a small set of intent-specific, user-initiated tasks, for example:

- create and run a small Jupyter notebook;
- solve or explore a mathematical example;
- upload or inspect data and make a plot;
- create and compile a short LaTeX document;
- explain the project and help the user choose their own next task.

The user must choose and submit the task. Do not silently send an automatic
prompt merely to manufacture AI engagement. Codex should work in the actual
project with a bounded onboarding policy, narrate consequential actions, and end
with a clear handoff such as running a cell, editing a generated file, asking a
follow-up, or choosing an independent task.

The product flow should:

- resume after reload without duplicating a funded turn;
- expose skip/dismiss controls and never trap the user in chat;
- use current site-funded reservation, concurrency, pool, and kill-switch
  enforcement rather than a special unmetered path;
- degrade gracefully to ordinary project use when admission is denied or Codex
  fails;
- distinguish site-funded free, site-funded paid, and user-funded Codex;
- record no prompt, response, code, filename, or generated artifact in growth
  analytics.

Record offer visible, task selected, prompt submitted, funded admission outcome,
backend acknowledgement, first response visible, guided task completion,
dismissal, and subsequent self-directed work. The existing Codex v2 traces
provide response latency and reliability; provider-side reservations provide
authoritative cost.

Primary outcome: `first_self_directed_work` within 24 hours. Secondary outcomes:
guided completion, meaningful work within 1 hour, D1/D7 project-work retention,
second independent Codex turn, and paid conversion. Guardrails: first-response
failure/incompletion, p95 response latency, funded-pool denial, cost per exposed
account, cost per assisted activation, support incidents, and ordinary non-AI
activation.

### Experiment Structure and Rollout

Decision update (2026-08-09): ship the first-run wizard as the default after
scenario-based staging acceptance rather than withholding it from a control
cohort. Current activation is poor enough, the intervention follows standard
onboarding practice, and a few hundred daily signups would make a long-running
multi-variant test both slow and operationally distracting. Measure release
cohorts and weekday/acquisition-adjusted before/after outcomes instead. Preserve
the event dimensions needed for a controlled experiment if a later,
genuinely uncertain onboarding choice warrants one.

Keep a release annotation and compare equivalent weekday and acquisition
cohorts before and after rollout. Analyze institutional/course bursts
separately so one class signup does not decide the general consumer experience.
If a later controlled test is justified, assign before the first onboarding
surface, stratify by acquisition and legacy/invite eligibility, and retain the
assignment across reloads.

Roll out in this order:

1. instrument the account-to-project-to-surface funnel and preserve the current
   weekday/acquisition baseline;
2. dogfood and canary the first-project wizard with failure paths forced;
3. make the wizard and user-initiated Codex path the default after staging
   acceptance;
4. monitor project creation, visible surface, self-directed work, failures,
   support contacts, and D1/D7 outcomes by release cohort;
5. iterate promptly on observed friction rather than waiting for an
   underpowered A/B test;
6. preserve release annotations and onboarding versions in serving data.

The first iteration should optimize successful passage to a real work surface,
not maximize wizard completion. A user who skips onboarding and productively
uses CoCalc is a success, not an abandonment.

## Experimentation Support

Systematic improvement requires controlled measurement, not only graphs.

Add stable experiment exposure records with:

- experiment key and definition version;
- account or pseudonymous visitor assignment;
- variant;
- first exposure timestamp;
- eligibility rule version;
- source release.

Assignments must be stable and recorded before the treatment is shown. Product
events carry experiment exposure dimensions so the materializer can compute
activation and retention by variant.

For each experiment define before launch:

- one primary outcome, such as activation within 24 hours;
- one or two secondary outcomes, such as D7 project-work retention;
- guardrails, such as auth failure, project-start failure, support incidents,
  or paid conversion;
- minimum sample size and observation horizon.

The dashboard must not automatically declare significance from repeated peeking.
Initially it may report counts, rates, intervals, and maturity without trying to
be a full statistical platform.

## Privacy, Security, and Data Retention

- Product analytics contains no user content.
- Never collect file paths, filenames, code, terminal input, prompts, outputs,
  full referrer paths, email addresses, or IP addresses in the growth tables.
- Validate event payloads against event-specific schemas.
- Keep raw authenticated events account-home scoped.
- Keep raw events for 90 days by default; retain daily boolean facts and
  aggregate counts long term.
- Respect account deletion and applicable PII policy for account-level facts.
  Anonymous aggregate counts may remain when legally appropriate.
- Restrict account-level analytics tables to backend workers. Admin APIs return
  aggregate rows only.
- Enforce a minimum cohort size for segmented results.
- Audit manual rebuilds, annotation changes, and changes to exclusion
  classification.
- Self-hosted deployments keep their analytics local; no telemetry is sent to
  SageMath, Inc. unless an administrator explicitly opts in.

## Historical Data and Backfill

Do not delay canonical collection while attempting a perfect backfill.

### Safe Backfill

Backfill what has a defensible meaning:

- account creation and stable cohort dates from `accounts`;
- first-touch attribution where the `analytics` link still exists;
- email-auth funnel data from `email_auth_challenges` for its available period;
- recent browser-project proxy activity from `ux_latency_events`;
- allowlisted v2 UX trace latency/outcome aggregates from their actual coverage
  start, with success sampling weights and trace versions preserved;
- recent compute activity from `account_cpu_usage_events`;
- selected runtime reservation events where actor identity is reliable.

Do not backfill account/day activity from sampled v2 successes. Existing
`active_user_map_history_*` rows remain their own durable regional series and
need no account-level backfill or duplication.

### Backfill Rules

- Tag backfilled facts with a source and metric-definition version.
- Never combine legacy proxy history with canonical v1 activity without a
  visible boundary.
- Expose `coverage_start` per signal.
- Use null for unavailable history; do not manufacture zeros.
- Preserve the old page or export briefly for comparison, then remove it.
- Do not use current `last_active`, `last_opened_at`, or `last_activity_at` to
  invent historical daily activity.

The recommended UI is to show canonical v1 metrics beginning on the deployment
date, with a separately labeled legacy-proxy series where useful.

## Implementation Sequence

### Minimum Fast Release Slice

The first releasable slice is intentionally smaller than the full plan. It
contains:

1. `growth_account_profiles`, `growth_account_activity_daily`, materialization
   state, dirty periods, and the three serving tables;
2. server-observed identity proof, account creation, project creation, and AI
   prompt events;
3. deliberate project entry, foreground engagement, notebook execution,
   terminal submission, and editor modification categories;
4. translation of allowlisted v2 UX trace outcomes into bounded latency and
   reliability aggregates, without using sampled traces as canonical activity;
5. restart-safe daily and weekly materialization;
6. summary, active-user, retention, and activation-funnel aggregate APIs;
7. `/admin/retention` cutover with data-health metadata;
8. clearly labeled recent proxy backfill where available.

Experiments, paid-conversion panels, extensive segment combinations, global
multibay replication, and polished annotation workflows may follow. They must
not delay removing raw request-time SQL from `/admin/retention`.

### Phase 0: Metric Contract and Baseline

1. Approve the definitions and review decisions at the end of this document.
2. Capture current `/admin/retention` query timings and `EXPLAIN (ANALYZE,
BUFFERS)` in staging with production-scale synthetic data.
3. Inventory existing `active_user_map_history_*`, `ux_latency_events`, email
   auth, attribution, project lifecycle, and site-funded Codex sources, with
   authority, sampling, consent, retention, and coverage boundaries.
4. Record the canonical metric-definition version and collection start time.
5. Add a data dictionary visible from the admin page.

### Phase 1: Storage and Restart-Safe Materializer

1. Add schema definitions for profiles, milestones, daily facts, worker state,
   dirty periods, and aggregate serving tables.
2. Update `table-ownership.ts` with explicit account-home, audit-local, and
   aggregate-projection classifications.
3. Add event-specific validation and idempotent ingest helpers.
4. Implement DB-leased materialization and repair loops.
5. Start the worker from the normal server maintenance startup path.
6. Add unit, integration, restart, duplicate, and late-event tests.
7. Run in shadow mode and expose worker health before changing the page.

### Phase 2: Signup, Attribution, and Activation Instrumentation

1. Record email and SSO funnel milestones server-side.
2. Snapshot first-touch acquisition into `growth_account_profiles`.
3. Record project creation and deliberate project entry.
4. Record high-intent notebook, terminal, editor, and AI action categories.
5. Implement foreground engagement with visibility-aware rate limiting.
6. Verify that automatic reconnect and restored tabs do not count as deliberate
   activity.
7. Reuse v2 UX traces for time-to-value and failure outcomes, and add unsampled
   semantic events only for missing canonical milestones/activity bits.
8. Snapshot Codex eligibility/funding class and materialize reservation cost,
   admission outcome, and first-response reliability without user content.

### Phase 3: Fast Admin Cutover

1. Add the dedicated typed growth analytics Conat API.
2. Implement summary, active-user, funnel, retention, growth-accounting, and
   health queries against serving tables only.
3. Replace `retention-overview.tsx` with the new dashboard.
4. Keep legacy proxy comparison behind a clearly labeled control.
5. Reduce the client timeout to five seconds.
6. Validate page and API SLOs with a cold cache and after hub restart.

This phase is the minimum acceptable release. The page must not retain a hidden
fallback to the current raw-event SQL.

### Phase 4: Backfill and Reconciliation

1. Backfill profiles and defensible recent proxy facts in bounded batches.
2. Add source-versus-fact and fact-versus-aggregate reconciliation jobs.
3. Validate counts against independent one-off SQL for sampled periods.
4. Annotate historical coverage boundaries and known incidents.
5. Remove request-time raw analytics queries.

### Parallel Workstream: Unit Economics and Capacity

This work may begin after the Phase 1 worker framework is proven, but it does
not block the Phase 3 retention cutover.

1. Enable read-only provider billing exports with invoice-level reconciliation;
   do not depend on an operator's interactive cloud login.
2. Inventory every production, staging, development, and customer-funded cloud
   resource and classify it as direct metered, shared variable, shared fixed,
   regional step, internal, or unallocated.
3. Add provider-cost, resource-usage, capacity, revenue-accrual, and allocation
   daily tables with importer and allocation versions.
4. Materialize host CPU, memory, disk, I/O, pressure, project concurrency, and
   denial summaries from telemetry without scanning raw events in admin
   requests.
5. Add account/project disk byte-hour attribution and verify CPU attribution
   against independent host-level totals.
6. Map subscriptions, annual plans, site-license contracts, customer-funded
   resources, free service, and internal use to bounded economic-principal
   classes.
7. Reconcile catalog estimates to provider billing and expose missing,
   duplicated, stale, and unallocated cost.
8. Implement versioned allocation rules and an `/admin/economics` serving API
   that reads only bounded daily/monthly aggregates.
9. Add alerts for provider-cost import failure, reconciliation drift, unexpected
   unit-cost changes, regional capacity thresholds, and approaching capacity
   cliffs.
10. Establish a monthly pricing and efficiency review using actual cost,
    headroom, product contribution margin, and retained-user outcomes.

### Phase 5: Experiments and Data-Driven Growth Loop

1. Add stable experiment assignment and exposure recording.
2. Add variant segmentation to activation and retention aggregates.
3. Add experiment maturity and guardrail panels.
4. Instrument and baseline the account-to-first-project-to-visible-surface
   funnel using existing project/directory traces plus canonical milestones.
5. Operate and iterate on the default guided first-project flow using release
   cohorts and explicit outcome/failure events.
6. Evaluate the optional site-funded Codex onboarding path using self-directed
   work and D1/D7 retention rather than guided prompt submission alone.
7. Establish a weekly review cadence for acquisition, activation, retention,
   resurrection, cost per assisted activation, and experiment outcomes.
8. Require new signup/onboarding projects to specify their expected metric and
   add or reuse instrumentation before launch.

### Phase 6: Multibay Global Aggregation

This should be designed in Phase 1 even if deployment remains one bay.

1. Route authenticated facts to the account home bay.
2. Add durable cross-bay event outboxes for project-host activity.
3. Publish aggregate rows to the global analytics projection.
4. Reconcile per-bay totals against global totals.
5. Test account rehome behavior before marking account analytics portable.

## Likely Code Areas

Recommended new modules:

- `src/packages/util/db-schema/growth-analytics.ts`
- `src/packages/conat/hub/api/growth-analytics.ts`
- `src/packages/server/growth-analytics/schema.ts`
- `src/packages/server/growth-analytics/events.ts`
- `src/packages/server/growth-analytics/ingest.ts`
- `src/packages/server/growth-analytics/materialize.ts`
- `src/packages/server/growth-analytics/queries.ts`
- `src/packages/server/growth-analytics/maintenance.ts`
- `src/packages/server/conat/api/growth-analytics.ts`
- `src/packages/frontend/admin/growth-retention.tsx`
- `src/packages/frontend/monitoring/product-activity.ts`
- `src/packages/frontend/projects/onboarding/first-run-onboarding.tsx`
- `src/packages/frontend/projects/onboarding/state.ts`
- `src/packages/frontend/projects/onboarding/rootfs.ts`

Existing areas requiring integration:

- `src/packages/util/db-schema/active-user-map-history.ts` and
  `src/packages/server/active-user-map-history.ts` for existing aggregate-only
  regional history and convergence semantics;
- `src/packages/frontend/monitoring/ux-latency-trace.ts` and
  `src/packages/server/monitoring/ux-latency.ts` for existing sampled v2
  performance traces;
- `src/packages/frontend/project/listing/ux-latency.ts`, project actions, file
  open, Jupyter, terminal, upload, LaTeX, and Codex UX trace producers;
- `src/packages/server/ai/site-funded-codex-*` and project-host Codex metering
  for funded admission, outcome, and cost facts;
- email challenge completion and SSO account creation;
- account creation and attribution linking;
- project creation and user-initiated project opening;
- Jupyter cell execution;
- terminal input submission;
- editor modification/save state;
- AI prompt submission;
- membership and purchase completion;
- server maintenance startup;
- admin routing and documentation;
- table ownership metadata.

The implemented onboarding state is versioned in account `other_settings`, so
it follows account-home authority and survives reloads and devices. Analytics
events describe exposure and outcomes but do not control the UI. Session
storage is used only to avoid showing the unrelated marketing-email prompt in
the same session, never as durable onboarding state.

The current retention RPCs may temporarily delegate to the new serving queries,
but the long-term API should move out of purchases.

## Validation Plan

### Metric Semantics

Test:

- UTC day and Monday-week boundaries;
- D0, D1, D7, W1, and rolling retention definitions;
- incomplete period handling;
- eligible versus excluded populations;
- exact new/retained/resurrected/churned classification;
- attribution normalization;
- experiment assignment stability;
- membership-tier snapshot semantics.
- guided versus self-directed activation semantics;
- project/Codex onboarding eligibility and invite/deep-link bypass;
- rolling location-map activity versus canonical UTC DAU labeling;
- success-sampled UX traces never creating false inactivity or unweighted
  conversion counts.

### Pipeline Correctness

Test:

- duplicate event delivery;
- out-of-order and late events;
- worker crash before and after transaction commit;
- two hubs competing for the same scope;
- control-plane restart during materialization;
- dirty-period repair;
- source event expiration after facts are materialized;
- account ban/unban and test-account reclassification;
- cross-bay delivery retry and deduplication.
- UX trace-to-growth outcome translation with version, stale/visibility, and
  sampling boundaries;
- site-funded Codex reservation admission/cost reconciliation without prompt or
  response content;
- onboarding resume, skip, duplicate-submit, failed project creation, failed
  project start, Codex denial, and Codex failure paths.

### Performance

Generate synthetic data substantially larger than current production:

- at least 10 million account/day/signal facts;
- at least five years of daily aggregates;
- hundreds of cohort and segment combinations;
- concurrent admin requests from multiple hubs.

Assert:

- no serving query scans raw event or account fact tables;
- indexed plans are stable;
- result row counts are bounded;
- default cold responses meet the 250 ms target;
- hub restart does not cause an expensive first request;
- materialization catches up without blocking normal product traffic.

### Staging Acceptance

Run old and new metrics side by side for at least seven days. Differences should
be explained by the definition, not unexplained loss. Deliberately restart the
control plane, pause the worker, deliver duplicate and late events, and confirm
that the system converges without manual intervention.

Before an onboarding experiment reaches production, exercise the full first-use
path in staging with new, legacy, invited, course, registration-token, mobile,
Codex-admitted, Codex-denied, and project-start-failure accounts. Confirm that
analytics failure cannot block project creation or Codex and that no event
contains user content.

## Operational Rollout

1. Deploy schema and shadow collection to staging.
2. Validate privacy payloads and worker convergence.
3. Load-test serving queries and materialization.
4. Deploy shadow collection to production with no UI cutover.
5. Compare independent sampled counts and monitor database write volume.
6. Enable the new admin page for staff behind a feature flag.
7. Make the new page default after SLO and correctness review.
8. Keep the old implementation available for a short diagnostic window.
9. Remove raw request-time SQL and eventually retire `crm_retention` after
   confirming there are no remaining CRM consumers.

Rollback disables collection and returns the admin route to the old page; it
does not drop facts or serving tables. The new worker must be independently
disableable through a server setting or environment variable.

## Success Criteria

This project is successful when:

- `/admin/retention` is consistently fast regardless of history size;
- SageMath, Inc. can state exact D1/D7/D30 and W1/W4 retention under a stable
  definition;
- signups can be compared by retained and activated users per acquisition
  channel;
- email, SSO, invitation, and project activation funnels expose measurable
  losses;
- active growth separates acquisition from retention, resurrection, and churn;
- experiments can be tied to activation and retention outcomes;
- the account-to-project-to-visible-surface funnel identifies where first-time
  users fail or abandon and how long each step took;
- guided first-project and Codex onboarding can be evaluated by subsequent
  self-directed work, D1/D7 retention, reliability, and provider cost;
- regional active-user history is available long term with explicit consent
  coverage and is not mislabeled as canonical retention;
- average and marginal infrastructure cost use explicit denominators and cost
  classes, with provider actuals reconciled to estimates;
- regional capacity cliffs and their expected monthly cost are visible before
  service quality degrades;
- contribution margin can be compared by product and acquisition cohort without
  treating a pricing markup as gross margin;
- data freshness and coverage are visible and alerted;
- restarts, duplicate events, late events, and multiple hubs converge without
  manual repair;
- no user content or unnecessary PII is collected;
- the design scales from one-bay Launchpad to multibay Rocket.

## Review Decisions

Recommended defaults for approval:

1. Use `project_engaged_v1` as the headline active-user definition and
   `project_work_v1` as the stricter comparison.
2. Define activation as first meaningful project work within 24 elapsed hours.
3. Use UTC calendar periods and Monday-based weeks.
4. Default retention cohorts to verified, non-ephemeral, non-staff, non-test,
   non-banned human accounts.
5. Retain raw validated product events for 90 days and daily boolean facts plus
   aggregates long term.
6. Suppress segmented cells containing fewer than 20 accounts.
7. Start canonical v1 history at deployment and show any backfill as a separate
   legacy-proxy definition.
8. Permit only allowlisted segment sets rather than arbitrary dimension
   combinations.
9. Build account-home ownership and aggregate-only global replication now,
   despite the current deployment being mostly one bay.
10. Treat dashboard performance and worker convergence as release blockers, not
    follow-up optimization work.
11. Keep source cost, revenue, allocation, and capacity facts separate; show
    cost inclusion, denominator, source confidence, and allocation version on
    every unit-economics metric.
12. Reuse `active_user_map_history_*` as the regional-adoption series; do not
    duplicate it or use its rolling `last_active` counts as canonical retention.
13. Use v2 UX traces for latency and reliability, but require unsampled,
    rate-limited semantic events for canonical milestones and activity facts.
14. Ship the guided first-project flow after scenario-based staging acceptance,
    including an optional user-initiated site-funded Codex path; reserve
    controlled experiments for later uncertain choices with adequate power.
15. Judge Codex onboarding primarily by later self-directed work and mature
    retention, not by the guided prompt that the treatment itself caused.
