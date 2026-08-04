# Site-Funded Codex Luna Plan

Status: proposed implementation and controlled-rollout plan as of 2026-08-02.

## Strategic Premise

OpenAI reduced GPT-5.6 Luna API pricing by 80% on 2026-07-30. Standard
processing now costs:

- $0.20 per million input tokens;
- $0.02 per million cached-input tokens;
- $0.25 per million cache-write tokens (1.25x uncached input);
- $1.20 per million output tokens.

Requests with more than 272K input tokens retain the documented long-context
multiplier: 2x input and 1.5x output for the full request.

Official references:

- https://openai.com/index/advancing-the-price-performance-frontier-with-gpt-5-6/
- https://developers.openai.com/api/docs/models/gpt-5.6-luna
- https://developers.openai.com/api/docs/guides/prompt-caching

Measured Luna/low/standard Codex turns in this repository cost approximately:

- $0.0007 for a trivial response;
- $0.007 for a small source investigation;
- $0.013 for a deeper multistep architecture investigation.

These measurements do not establish permanent product limits, but they show
that a small site-funded allowance can provide a real Codex experience. This
could materially improve activation: a new CoCalc user can discover agentic
work in their actual project without first understanding API keys, purchasing
an OpenAI subscription, or configuring external credentials.

The product opportunity is large enough to justify a careful implementation,
but the shared credential creates direct financial risk. The system must have
correct accounting, hard local per-turn bounds, atomic global reservations,
and a fast kill switch before broad availability.

## Goals

1. Give eligible users useful site-funded Codex access with no external AI
   setup.
2. Restrict site-funded runs to a centrally configured safe policy, initially:
   `gpt-5.6-luna`, low reasoning, and standard speed.
3. Account for provider cost correctly, including cache reads, cache writes,
   output/reasoning tokens, long-context pricing, and separately priced tools.
4. Enforce membership/account limits without rounding tiny turns up to one
   cent.
5. Maintain a seed-authoritative global funding pool that cannot be exceeded by
   concurrent turns on different bays.
6. Bound the maximum financial exposure of one turn even if the user requests
   unbounded autonomous work.
7. Gather enough cost, reliability, adoption, and conversion data to adjust
   limits intelligently.
8. Preserve normal user-funded Codex behavior. Users with their own ChatGPT
   subscription or API key retain their selected model, reasoning, speed, and
   normal limits.

## Non-Goals

1. Reselling arbitrary OpenAI API access.
2. Exposing the site API key to browsers, project shells, or users.
3. Funding arbitrary models, fast mode, ultra/multi-agent mode, hosted tools,
   image generation, or web-search fees in the initial release.
4. Guaranteeing that Luna can solve every task that Sol can solve.
5. Treating OpenAI's project budget notification as a hard spending limit. It
   is explicitly a soft threshold.
6. Launching globally before provider-cost reconciliation and concurrency tests
   pass.

## Current Implementation

The existing site-key path already provides a useful foundation:

1. Project-host obtains the site OpenAI key.
2. `CodexAppServerAgent` identifies `site-api-key` as the auth source.
3. The site-key governor checks allowance before a turn.
4. It polls allowance during a running turn.
5. It reports aggregate usage after successful completion.
6. Membership AI limits use 5-hour and 7-day windows.
7. `launch_disable_ai` is a dynamic global kill switch.

Relevant files:

- `src/packages/ai/acp/codex-site-key-governor.ts`
- `src/packages/ai/acp/codex-app-server.ts`
- `src/packages/project-host/codex/codex-site-metering.ts`
- `src/packages/project-host/codex/codex-auth.ts`
- `src/packages/project-host/codex/codex-project.ts`
- `src/packages/server/conat/api/hosts.ts`
- `src/packages/server/ai/usage-units.ts`
- `src/packages/server/ai/usage-status.ts`
- `src/packages/server/ai/save-response.ts`
- `src/packages/util/db-schema/ai-models.ts`
- `docs/codex-auth.md`

## Current Accounting And Safety Gaps

### Model fallback is wrong

`gpt-5.6-luna` is a Codex model name but not a central
`LanguageModelCore`. Site-key usage therefore falls back to `gpt-5-mini`
pricing. Unknown funded models must never silently use a fallback price.

### Cached input is double counted

Provider `input_tokens` includes cached tokens. Current project-host metering
adds `input_tokens + cached_input_tokens`, treating the fields as disjoint.

### Cache writes are missing

GPT-5.6 reports `cache_write_tokens`, billed at 1.25x uncached input. The
current ACP usage type and RPC omit this field.

### Long-context pricing cannot be derived from aggregate turn usage

The 272K threshold applies to each provider request, not to aggregate tokens
across an agent turn. A final turn total cannot identify which requests crossed
the threshold.

### Tiny turns are rounded too aggressively

`AI_USAGE_UNITS_PER_DOLLAR = 100` plus a minimum one-unit charge makes every
turn cost at least one cent for quota purposes. A real Luna turn may cost less
than one tenth of one cent.

### Completed-turn reporting is not a hard bound

A check-before/report-after system can overspend through concurrent turns. The
current periodic poll is also too coarse to bound a single request already in
flight.

### Interrupted and failed turns may not be recorded completely

Provider cost is incurred even if the turn is interrupted, the browser
disconnects, the project host restarts, or final usage reporting fails.

### Model restrictions are not authoritative

The frontend can limit choices, but current server-side configuration still
accepts the requested model, reasoning level, and service tier. Site-funded
policy must be enforced below the UI and rechecked at the provider boundary.

## Core Design Decision: Project-Host-Local Provider Proxy

Broad site-funded access should not send the shared API key directly into the
Codex runtime. Introduce a small OpenAI-compatible proxy on each project host
for site-funded traffic only.

The proxy:

1. holds or obtains the real site API key outside the user Codex container;
2. gives the Codex runtime a short-lived, turn-scoped proxy credential;
3. receives every provider request and streaming response;
4. enforces the funded policy on request fields;
5. observes exact per-request usage, including cache reads and writes;
6. applies request and turn limits locally;
7. emits idempotent usage events to the authoritative funding service;
8. never stores request or response bodies for accounting.

The Codex runtime receives an OpenAI base URL pointing at the local proxy and a
scoped proxy token, not the provider key. User-funded API-key and subscription
auth continue using their existing paths and bypass the funded proxy.

This follows the control/data-plane rule:

- the seed/global layer makes small admission and reservation decisions;
- provider traffic flows directly from project host to OpenAI;
- model responses do not pass through a hub or bay control plane.

If the current Codex app-server cannot use a custom OpenAI base URL with the
required auth behavior, Phase 0 must prove an equivalent wrapper/interception
point before implementation proceeds. Do not launch broad site funding based
only on aggregate app-server usage.

## Target Flow

```text
Browser
  -> project host Codex/ACP
  -> seed funding admission: reserve global + account maximum
  -> project-host-local funded OpenAI proxy
  -> OpenAI Responses API
  -> proxy records exact request usage and enforces local turn cap
  -> seed funding commit/release
  -> account-home usage projection and admin analytics
```

Detailed lifecycle:

1. ACP resolves the auth source.
2. User-funded auth follows the existing path.
3. Site-funded auth requests a reservation using a generated
   `funded_turn_id` and idempotency key.
4. The seed funding service checks:
   - global kill switch;
   - funded-mode enabled setting;
   - account eligibility;
   - per-account 5-hour and 7-day limits;
   - per-account concurrent-turn limit;
   - global pool committed plus reserved amount;
   - configured policy version.
5. The service atomically reserves the maximum exposure and returns:
   - `reservation_id`;
   - expiration and heartbeat interval;
   - effective funded policy;
   - a signed/scoped proxy authorization claim.
6. ACP replaces user-requested funded configuration with the effective policy
   before `thread/start`, `thread/resume`, and `turn/start`.
7. The local proxy independently validates the same policy.
8. Each provider response produces an idempotent usage event.
9. The proxy stops additional provider calls when the turn budget is exhausted.
10. On completion, interruption, failure, or timeout, project-host commits
    observed cost and releases the unused reservation.
11. A seed maintenance worker expires abandoned reservations and commits any
    usage events already received.

## Funded Policy

Define a versioned `SiteFundedCodexPolicy` shared across server, project-host,
ACP, and frontend types.

Initial effective policy:

```ts
{
  version: 1,
  model: "gpt-5.6-luna",
  reasoning: "low",
  serviceTier: "standard",
  maxConcurrentTurnsPerAccount: 1,
  maxTurnCostMicrousd: 50_000,
  maxTurnDurationMs: 20 * 60_000,
  maxInputTokensPerRequest: 128_000,
  maxOutputTokensPerRequest: 8_000,
  allowFastMode: false,
  allowUltraOrMultiAgent: false,
  allowedProviderTools: [],
}
```

The initial values are pilot defaults, not permanent promises. In particular,
the 5-cent turn bound should be validated against real implementation tasks.

Enforcement rules:

- Rewrite the effective ACP configuration to Luna/low/standard for funded
  turns; do not merely hide other controls.
- Persist and stream the effective configuration so the UI reports reality.
- Validate model, reasoning, service tier, output bound, and tools again in the
  local proxy.
- Reject an unknown or newly introduced request mode rather than forwarding it
  under the shared key.
- Resume an existing thread under the funded policy only after rewriting its
  session metadata and applying per-turn overrides.
- Make the UI clear that connecting a personal subscription or API key restores
  the user's normal model and reasoning choices.

## Exact Cost Accounting

### Money representation

Use integer micro-US-dollars throughout funded accounting:

- `1 USD = 1_000_000 microusd`;
- $0.0007 is approximately 700 microusd;
- database columns use `BIGINT`;
- TypeScript converts database `BIGINT` values without passing through unsafe
  floating-point integer ranges;
- pricing calculations use `Decimal`, then round provider liability upward to
  the nearest microusd.

Do not reuse a one-cent minimum charge. Membership limits can still be entered
and displayed in dollars while enforcement converts them to microusd.

### Versioned price catalog

Create a Codex/provider pricing catalog independent of the legacy chat model
union. A price version records:

- provider and canonical model ID;
- effective start and optional end time;
- standard input, cached-input, cache-write, and output rates;
- fast/service-tier multiplier or rates;
- long-context threshold and multipliers;
- separately priced provider tools;
- source URL and last verification time.

Never silently fall back when a funded model has no exact price. Admission must
fail closed with an operator-visible configuration error.

### Per-request formula

For each provider request:

```text
input_total = provider input_tokens
cached_read = provider cached_tokens
cache_write = provider cache_write_tokens
ordinary_input = input_total - cached_read - cache_write

cost = ordinary_input * ordinary_input_rate
     + cached_read * cached_input_rate
     + cache_write * cache_write_rate
     + output_tokens * output_rate
     + provider_tool_fees
```

Requirements:

- cached and cache-write tokens are subsets of total input, not extra input;
- reject or quarantine malformed usage where subsets exceed total input;
- output includes reasoning output and must be billed once;
- record reasoning tokens separately for analysis, not as an additional cost;
- apply the long-context multiplier from the individual request's input count;
- record the exact price version used;
- preserve provider request IDs for reconciliation, but do not expose them to
  users;
- account for failed/interrupted requests whenever the provider reports usage.

### Compatibility with existing AI usage

Add `cost_microusd` and detailed token columns to `ai_usage_log`, or introduce a
funded-turn ledger and project compatible rows into `ai_usage_log`. Existing
membership UI can continue using 5-hour and 7-day windows, but the authoritative
funded sum must be microusd.

`usage_units` remains a compatibility projection if needed:

```text
usage_units = cost_microusd * 100 / 1_000_000
```

Do not round each turn to a whole usage unit. Round only microusd provider
liability, then sum integers.

## Seed-Authoritative Budget Reservations

Global funded spend is one of the deliberately small global billing concerns
in the multibay architecture. The seed/global billing database is authoritative
for reservations and committed global cost.

Suggested tables follow. Exact names may change during implementation.

### `site_ai_funding_periods`

One row per pool and UTC funding period:

```text
pool_id
period_start
period_end
limit_microusd
reserved_microusd
committed_microusd
policy_version
created_at
updated_at
```

Primary key: `(pool_id, period_start)`.

The initial pool is `site-funded-codex-free`. Paid membership pools can remain
separate so free-user exhaustion does not unexpectedly consume or disable paid
benefits.

### `site_ai_turn_reservations`

```text
reservation_id UUID PRIMARY KEY
funded_turn_id UUID UNIQUE
idempotency_key TEXT UNIQUE
pool_id
period_start
account_id
project_id
host_id
home_bay_id
owning_bay_id
membership_tier
policy_version
model
reasoning
service_tier
reserved_microusd
committed_microusd
last_request_sequence
last_event_id
last_event_cost_microusd
last_event_price_version
last_event_long_context
status active|committed|released|expired|interrupted|failed
started_at
heartbeat_at
expires_at
completed_at
outcome
```

This is bounded operational reservation state, not a second user-usage ledger.
Do not store prompt or response content here. Avoid storing full file paths; a
coarse surface tag such as `chat`, `jupyter`, or `editor` is enough for product
analysis.

### Canonical `ai_usage_log`

Write every exact site-funded provider request directly to the account home
bay's existing `ai_usage_log`. `funded_event_id` is the immutable idempotency
key, while `funded_turn_id` groups requests from one Codex turn. Store exact
token categories, price version, provider request ID, tool fees, long-context
status, request sequence, duration, and `cost_microusd` on the same row. This is
the only user AI usage ledger; do not maintain or backfill a parallel funded
Codex event table.

### Aggregates

Build daily aggregates from `ai_usage_log` instead of deleting raw financial
records prematurely. Keep exact non-content request rows for a defined audit
window, then retain daily aggregates longer.

## Atomic Reservation Semantics

Admission runs in one seed database transaction:

1. Lock the active funding-period row.
2. Resolve the account's applicable funded pool and account limits.
3. Reject if another funded turn is active beyond concurrency policy.
4. Reject if account committed plus active reservations reach its window.
5. Reject if global `committed + reserved + requested_reservation > limit`.
6. Insert the idempotent reservation.
7. Increment global reserved amount.
8. Commit and return the signed policy/reservation response.

Completion runs transactionally and idempotently:

1. Lock reservation and period.
2. Sum immutable provider events.
3. Move actual cost from reserved to committed.
4. Release unused reservation.
5. Mark final state.
6. Emit account-home projection/outbox events.

If actual cost exceeds the reservation due to provider/accounting uncertainty,
commit the real cost, record an invariant violation, disable new funded turns if
the safety margin is exhausted, and page/notify operators. Never hide real
provider liability to preserve a nominal cap.

## Bounding A Single Turn

Use several independent controls; runtime alone is insufficient.

### Financial reservation

Reserve the full configured turn exposure before starting. This makes maximum
concurrent global exposure explicit. Include a small uncertainty margin in the
global reservation while charging the account only actual cost.

### Request input bound

Prevent funded requests above the configured context bound, initially 128K.
Request Codex compaction or ask the user to start a fresh thread rather than
crossing the 272K pricing threshold.

### Request output bound

Clamp provider output to an evaluated maximum, initially 8K tokens per request.
This includes hidden reasoning tokens and limits the cost of one in-flight
request.

### Running local cost counter

The project-host proxy accumulates exact cost after each provider response. It
must refuse the next provider request when the turn cap is exhausted.

### Duration and request count

Keep a hard elapsed-time limit and add a maximum provider-request/tool-loop
count. These protect against low-token infinite loops and operational load even
when token cost is tiny.

### Concurrency

Allow one site-funded turn per account initially. Optionally add a site-wide
concurrency ceiling as an operational guard independent of the dollar pool.

### Tool policy

Disable separately billed OpenAI hosted tools for the initial funded mode.
Local CoCalc shell, file, and patch tools remain available because they do not
expose the provider key and their infrastructure cost is controlled elsewhere.

## Global Pool Short Circuit

The global pool is a catastrophic-spend circuit breaker, not the primary user
experience limit.

Required controls:

- weekly limit in USD, stored as microusd;
- independent free and paid/member pools if both are funded;
- dynamic enable/disable setting;
- warning thresholds, initially 50%, 75%, 90%, and 100%;
- admin dashboard showing committed, reserved, projected, and reconciled cost;
- immediate denial of new reservations at the hard limit;
- existing `launch_disable_ai` remains the fastest complete stop;
- a narrower `site_funded_codex_enabled` switch disables only subsidized
  access, leaving user-funded Codex available.

Initial pilot suggestion:

- free global pool: $100/week;
- free account allowance: $0.10/week;
- free 5-hour allowance: $0.05;
- maximum turn cost: $0.05;
- one concurrent funded turn/account;
- separate internal/test pool during preproduction.

These are starting hypotheses. The admin must be able to adjust them without a
deployment, and the product should not promise that exact values are permanent.

## Account Eligibility And Abuse Controls

Initial free eligibility should require:

- signed-in account;
- verified email;
- account not banned or held;
- membership/policy permits site-funded AI;
- no active funded turn beyond the concurrency limit;
- no exhausted 5-hour or 7-day funded allowance.

Before full rollout, analyze whether to require a minimum account age,
successful project activity, institutional affiliation, or other low-friction
signals. Per-account limits alone do not address account-farm/Sybil abuse.

Record denial reasons without logging user prompts. Add scoped operator holds
for funded AI so abuse response does not require banning the entire account.

## Data And Observability

### Financial metrics

Collect:

- actual and reserved microusd by hour/day/week;
- cost by membership tier and rollout cohort;
- p50/p75/p90/p95/p99 cost per turn;
- maximum turn and maximum request cost;
- committed/reserved/global-pool utilization;
- reservation expiration and unused-reservation ratios;
- local ledger versus OpenAI billed-cost discrepancy;
- cost from cache reads, writes, ordinary input, output, and tools;
- long-context request count and cost;
- cost of interrupted, failed, and abandoned turns.

### Token and agent metrics

Collect:

- provider requests per turn;
- input, cached-read, cache-write, output, and reasoning tokens;
- cache-read and cache-write ratios;
- elapsed time and tool-loop count;
- completion, interruption, timeout, policy cutoff, and provider error rates;
- context compaction and context-limit denials.

### Product metrics

Collect privacy-preserving aggregates for:

- eligible accounts shown the funded option;
- first funded turn activation rate;
- funded turns per activated account;
- 1-day, 7-day, and 28-day repeat use;
- fraction later connecting a personal subscription/API key;
- membership conversion and retention by exposure cohort;
- broad surface (`chat`, `jupyter`, `editor`) without prompt or file content;
- explicit user feedback where offered.

Do not infer task success merely from a completed API response. Where possible,
use coarse downstream signals such as a turn that produced accepted edits or
successful validation, but keep these metrics separate from financial truth.

### Provider reconciliation

Use a dedicated OpenAI Project/API key for site-funded Codex. Poll the OpenAI
organization Usage/Costs APIs and compare provider-billed cost with the local
ledger by time bucket and model.

Reconciliation requirements:

- hourly usage/token comparison when available;
- daily billed-cost comparison;
- alert on absolute and percentage discrepancy;
- preserve price-version history;
- do not treat OpenAI's project monthly budget as a hard cap;
- provide an operator command/report that explains discrepancies by token
  category, failed reports, and timing lag.

## Site Settings And Membership Configuration

Add seed-authoritative settings, propagated through the existing site-settings
mechanism:

- `site_funded_codex_enabled`
- `site_funded_codex_model`
- `site_funded_codex_reasoning`
- `site_funded_codex_service_tier`
- `site_funded_codex_free_pool_weekly_usd`
- `site_funded_codex_paid_pool_weekly_usd`
- `site_funded_codex_max_turn_usd`
- `site_funded_codex_max_turn_seconds`
- `site_funded_codex_max_input_tokens_per_request`
- `site_funded_codex_max_output_tokens_per_request`
- `site_funded_codex_max_requests_per_turn`
- `site_funded_codex_global_concurrency`
- reconciliation warning thresholds.

Membership `ai_limits` define the authoritative account 5-hour and 7-day
allowances, including account entitlement overrides. The current representation
uses one-cent units (100 units = US$1), converted exactly to microusd at funded
admission and status boundaries. Do not add separate free/member fallback
allowances to site settings. An explicit feature entitlement could be added
later if the product must distinguish a zero budget from a disabled feature.

Dangerous policy changes and pool-limit increases require the existing fresh
admin authentication used for global site settings.

## User Experience

When site funding is selected:

- label it clearly, for example `Included by CoCalc`;
- show `GPT-5.6 Luna`, `Low reasoning`, and `Standard speed` as fixed policy;
- do not show controls that appear selectable but will be ignored;
- explain that connecting ChatGPT or an API key unlocks other models and
  settings;
- show remaining 5-hour and 7-day included usage in understandable terms;
- report global-pool exhaustion as temporary site-funded capacity exhaustion,
  not as an account fault;
- distinguish per-account limit, per-turn limit, global pool, policy, and
  provider failures;
- preserve the user's prompt and allow retry with personal funding after a
  funded denial.

Avoid promising a number of turns. Turn cost varies significantly with context
and work performed. Display dollar-equivalent included usage or a carefully
defined product unit backed by exact microusd accounting.

## Multibay Authority

Authority must be explicit:

- seed/global billing service: funding periods, global reservations, global
  committed cost, provider reconciliation, price catalog;
- account home bay: membership resolution and account-facing usage projection;
- project owning bay: project/host authorization and routing;
- project host: local provider proxy, request enforcement, exact usage event
  creation, interruption;
- browser: display only, never authoritative policy enforcement.

The owning bay must not assume its local `ai_usage_log` is authoritative for an
account whose home bay differs. Reservation RPCs route to the seed service;
committed account usage is projected to the account home bay through an outbox
or explicit inter-bay service.

Launchpad remains the one-bay special case using the same interfaces.

## Failure Semantics

### Seed admission unavailable

Fail closed for new site-funded turns. Continue allowing user-funded Codex.

### Seed unavailable during an admitted turn

The local proxy continues only within its signed reservation and hard local
turn limits. Buffer idempotent usage events durably on project-host and retry.

### Project-host restart

On restart, recover durable unreported proxy usage events. Reservation expiry
releases only unused exposure; already reported provider events remain
committed.

### Browser disconnect

Financial accounting follows the running turn, not the browser connection.
Normal durable-turn policy decides whether execution continues, while the local
cost bound remains active.

### Provider response lacks required usage

Stop additional funded requests, retain the reservation, mark the turn for
reconciliation, and alert if this recurs. Do not guess a cheaper cost.

### Price catalog missing or stale

Fail closed for the affected funded model. User-funded traffic is unaffected.

### Global pool exhausted

Deny new funded reservations immediately. Running turns remain bounded by
their already reserved exposure.

## Implementation Phases

### Phase 0: Provider and Codex feasibility proof

1. Capture raw Luna API-key Codex app-server usage notifications.
2. Verify current fields for cached reads, cache writes, request IDs, and
   per-request versus aggregate usage.
3. Prove Codex app-server works through a local OpenAI-compatible base URL.
4. Prove streaming usage can be observed without retaining content.
5. Determine reliable request input/output limit enforcement.
6. Record actual OpenAI project cost for a small corpus and compare formulas.

Exit gate: a written accounting fixture maps provider responses to invoice cost
within an agreed tolerance.

### Phase 1: Correct accounting primitives

1. Add the versioned funded price catalog with current Luna rates.
2. Add detailed token types, provider request identity, and microusd helpers.
3. Remove cached-token double counting.
4. Remove per-turn one-cent minimum from funded usage.
5. Add long-context and cache-write tests.
6. Reject unknown funded model pricing.
7. Preserve compatibility projections for existing usage UI.

Exit gate: deterministic fixtures cover ordinary, cached, cache-write,
reasoning, long-context, tool-fee, malformed, and interrupted usage.

### Phase 2: Seed funding ledger and atomic reservations

1. Add funding period, reservation, and provider-event tables.
2. Add seed-authoritative reserve, heartbeat, event-record, commit, release,
   and status APIs.
3. Add inter-bay routing and account-home projections.
4. Add abandoned-reservation maintenance.
5. Add free and paid/member pool separation.
6. Add dynamic settings and kill switches.

Exit gate: concurrent tests from multiple simulated bays cannot reserve one
microusd beyond the configured pool.

### Phase 3: Project-host funded proxy

1. Implement local proxy lifecycle and scoped proxy credentials.
2. Keep the real API key outside Codex containers.
3. Enforce model/reasoning/service/tool policy.
4. Enforce request, turn-cost, request-count, duration, and concurrency bounds.
5. Persist unreported usage events across restart.
6. Integrate reservation lifecycle into ACP/Codex turn lifecycle.
7. Record failed and interrupted turn cost.

Exit gate: adversarial tests cannot select Sol, fast mode, higher reasoning, a
paid hosted tool, excessive output, or additional requests after the local cap.

### Phase 4: UI, admin observability, and reconciliation

1. Add funded-mode UI and effective fixed-policy display.
2. Add account remaining-usage display and denial messages.
3. Add admin pool dashboard, cohort controls, and scoped account holds.
4. Add OpenAI Costs API reconciliation and discrepancy alerts.
5. Add financial/product aggregate exports.
6. Update `docs/codex-auth.md` and operator runbooks.

Exit gate: an operator can explain any turn's computed cost, current global
exposure, provider reconciliation status, and denial reason without reading
prompt content.

### Phase 5: Controlled rollout

1. Internal/admin accounts only.
2. Explicit invited cohort.
3. 1% of eligible verified free accounts.
4. 10%, then 25%, then 100%, with a hold period at each stage.
5. Add paid membership pools only after free-pilot accounting is stable.

Each stage requires cost, discrepancy, failure, abuse, and conversion review.

## Test Plan

### Unit tests

- all token category formulas;
- price effective dates and unknown-model rejection;
- decimal-to-microusd rounding;
- long-context threshold immediately below/at/above 272K;
- policy rewriting and proxy validation;
- malformed usage invariants;
- membership and pool selection.

### Database and concurrency tests

- simultaneous reservations at the exact pool boundary;
- idempotent admission and completion retries;
- duplicate exact provider events in `ai_usage_log`;
- expired and abandoned reservations;
- actual cost below, equal to, and unexpectedly above reservation;
- UTC week rollover;
- free and paid pool isolation;
- account rehome and cross-bay routing;
- maintenance worker races.

### Integration tests

- real Codex Luna turn through the local proxy;
- cached read followed by cache write accounting;
- interruption, timeout, browser disconnect, and project-host restart;
- provider 429/5xx and missing usage fields;
- global pool exhaustion while turns are running;
- dynamic kill switch;
- personal subscription/API-key path remains unrestricted and unbilled;
- effective policy shown consistently in streamed config and frontend.

### Adversarial tests

- request Sol/Terra under funded auth;
- request medium/high/max reasoning;
- request fast/priority service;
- resume a Sol thread under funded auth;
- attempt hosted paid tools;
- forge or replay proxy credentials;
- submit duplicate/reordered usage events;
- create concurrent turns across projects and bays;
- exhaust free accounts through account farming simulations.

## Rollout Dashboard And Decision Cadence

Review at least daily during the first two weeks:

- provider billed cost versus local committed cost;
- global committed plus reserved exposure;
- p50/p90/p99 and maximum turn cost;
- activated and repeat users;
- completed/error/cutoff rates;
- pool and account-limit denials;
- cache-write/read economics;
- long-context and compaction behavior;
- abuse indicators and account creation patterns;
- conversion to membership or user-funded AI.

After two weeks, set account and membership parameters from measured
distributions rather than intuition. A useful rule is to place normal users
well below the p90 weekly allowance while bounding p99 outliers with the turn
cap and global pool.

## Launch Acceptance Criteria

Do not enable site-funded Codex for all eligible users until:

1. Luna pricing is exact and versioned.
2. Cached tokens are not double counted.
3. Cache writes and long-context requests are accounted per provider request.
4. Interrupted and failed provider usage is retained.
5. Site-funded configuration is authoritatively Luna/low/standard.
6. The provider key is not available to the Codex runtime, browser, or project
   shell.
7. One turn has a tested hard local financial bound.
8. Atomic multibay tests prove the global pool cannot be over-reserved.
9. OpenAI billed-cost reconciliation is operating with alerts.
10. The global and funded-only kill switches work without deployment.
11. User-funded Codex remains available when funded access is exhausted or
    disabled.
12. Admins can observe committed, reserved, and reconciled spend in real time.

## Initial Product Hypothesis

The first public experiment should optimize for discovery, not generosity.

A verified free user receiving $0.10/week may get several serious Codex turns
at current Luna prices. That is enough to demonstrate value while a $100/week
global pool strictly bounds the experiment. If activation and retention improve
without abuse or material reconciliation error, CoCalc can increase allowances,
fund paid tiers more generously, or make Luna a standard membership benefit.

The global pool answers the financial-risk question. Exact accounting and
observability answer the product question. The local funded proxy and per-turn
limits answer the security and runaway-agent questions. All three are required
for this opportunity to be safely transformative rather than merely cheap.
