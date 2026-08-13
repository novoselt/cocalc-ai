# Codex Subagent Activity UX And Implementation Plan

Date: 2026-08-13

Status: proposed for review

## Executive Decision

CoCalc should expose Codex subagent work as a compact, live, grouped section in
the existing Activity panel.

The main chat remains the conversation between the user and the manager agent.
Subagent lifecycle events, task summaries, progress signals, results, and
failures belong in Activity. They must not appear as independent assistant
messages in the main conversation.

The closed activity chip should include a short subagent count while any are
active, for example:

```text
Running 2m 14s | 3 subagents working
```

Opening Activity should show one aggregated block rather than a chronological
wall of spawn, heartbeat, wait, and completion events:

```text
Subagents                         2 working | 1 done

  spinning  API audit             running       48s
            Check authorization boundaries...
            Active 4s ago

  check     Test review            completed     31s
            Run focused ACP tests...
            18 tests passed

  spinning  UI review              running       22s
            Find the activity renderer...
            Active 2s ago
```

Each row is compact. Expanding a row shows the full known task, model, reasoning
effort, lifecycle details, result or error, agent path, and copyable thread ID.
Full child transcripts are a separate on-demand feature; they should not be
copied into the parent activity log by default.

## Why This UX

The user needs to answer three questions without reading internal protocol
noise:

1. Is the turn genuinely doing work?
2. How many parallel workers are active, and what are they doing?
3. Did any worker fail or produce a useful result?

Showing every subagent message in the main chat would make the conversation
hard to follow, especially when several agents work concurrently. Showing only
an undifferentiated activity stream has the opposite problem: repeated protocol
events obscure the state of each worker.

An aggregated block gives a stable place for each subagent. Incoming events
update that row instead of creating visible noise. The manager remains
responsible for explaining the plan, integrating results, and producing the
final answer.

## Product Invariants

1. The manager is the only agent that speaks in the main chat transcript.
2. Subagent activity is visible while the turn is running and after reload.
3. A running subagent counts as backend activity for the parent turn's
   last-activity indicator.
4. The UI never claims that a subagent completed unless a terminal state was
   observed.
5. Failure, interruption, shutdown, and missing-agent states remain visible
   after the parent turn ends.
6. Replayed or duplicate app-server notifications do not create duplicate
   subagent rows.
7. Subagent streaming does not add writes to the collaborative `.chat` file or
   patchflow history.
8. ACP execution and subagent details remain project-host data-plane traffic.
   The hub must not proxy steady-state agent output.
9. The implementation consumes typed Codex app-server notifications. It must
   not scrape Codex rollout JSONL files.

## Current System

The relevant CoCalc path is already mostly suitable:

- `src/packages/ai/acp/codex-app-server.ts` translates Codex app-server
  notifications to CoCalc ACP stream messages.
- `src/packages/conat/ai/acp/types.ts` defines the shared stream schema.
- `src/packages/lite/hub/acp/index.ts` publishes live events and incrementally
  persists the full activity log outside `.chat` patchflow.
- `src/packages/frontend/chat/use-codex-log.ts` subscribes to and replays the
  live/persisted log.
- `src/packages/frontend/chat/codex-activity.tsx` normalizes raw events into
  activity rows.
- `src/packages/frontend/chat/agent-message-status.tsx` renders the compact
  running/activity chip.

The main live preview currently accepts only ACP `message` events. New
subagent events should remain excluded from that preview, which naturally
preserves the manager-only main-chat rule.

The recent completed-manager-message fix is complementary to this plan. The
manager's ordinary commentary must continue to appear in the main chat and
activity log even while subagents are working.

## Upstream Codex Inputs

Current Codex app-server v2 exposes the needed information through
`item/started`, `item/updated`, and `item/completed` notifications.

### `collabAgentToolCall`

This item provides:

- stable tool-call ID;
- tool: `spawnAgent`, `sendInput`, `resumeAgent`, `wait`, or `closeAgent`;
- status: `inProgress`, `completed`, or `failed`;
- sender thread ID;
- receiver thread IDs;
- spawn/input prompt when available;
- requested model and reasoning effort for spawned agents;
- last-known state for each receiver;
- terminal result or error message when available.

Receiver states currently include:

- `pendingInit`;
- `running`;
- `interrupted`;
- `completed`;
- `errored`;
- `shutdown`;
- `notFound`.

### `subAgentActivity`

This item provides:

- stable event ID;
- activity kind: `started`, `interacted`, or `interrupted`;
- subagent thread ID;
- canonical agent path, such as `/root/worker`.

The two item types are complementary. Tool-call items establish task metadata,
relationships, state, and results. Activity items establish liveness and the
canonical path.

The parent rollout JSONL and separate child rollout JSONL files remain useful
for diagnostics, but are not an application API and must not be part of the UI
implementation.

## Proposed ACP Schema

Add an event variant to `AcpStreamEvent` in
`src/packages/conat/ai/acp/types.ts`:

```ts
export type AcpSubagentStatus =
  | "requested"
  | "pending_init"
  | "running"
  | "completed"
  | "failed"
  | "interrupted"
  | "shutdown"
  | "not_found";

export type AcpSubagentAction =
  | "spawn"
  | "activity"
  | "send_input"
  | "resume"
  | "wait"
  | "close";

export type AcpSubagentEvent = {
  type: "subagent";
  // Stable upstream item/event ID. Used for replay deduplication.
  operationId: string;
  // The child thread ID. It is absent while a spawn request is pending.
  subagentId?: string;
  // The thread that initiated this operation. This supports nested agents.
  senderId?: string;
  // Canonical Codex path when known, e.g. /root/api-audit.
  agentPath?: string;
  action: AcpSubagentAction;
  status: AcpSubagentStatus;
  task?: string;
  model?: string;
  reasoning?: string;
  result?: string;
  error?: string;
};
```

The frontend reducer should define
`type AcpSubagentDisplayStatus = AcpSubagentStatus | "unknown"`. The derived
`unknown` state is not sent over the wire; it is used when the parent ends
without a terminal update for a child.

This is an update event, not a complete snapshot. The frontend reducer merges
events by `subagentId`, with `operationId` as the temporary identity before a
spawn returns its child thread ID.

The shared outer `AcpStreamMessage.time` and `seq` fields remain the received
timestamp and ordering authority. There is no need to duplicate them inside
the event.

### Why One Event Type

One partial-update event keeps the transport additive and provider-neutral.
The frontend does not need to know Codex's `collabAgentToolCall` shape, and a
future ACP provider can report the same lifecycle without pretending to use
Codex tools.

Separate event variants for spawn, heartbeat, result, and failure would make
the reducer more verbose without adding useful type safety. The explicit
`action` and `status` fields preserve those distinctions.

### Text Limits

The producer must bound copied text before adding it to the parent log:

- `task`: 16 KiB maximum;
- `result`: 32 KiB maximum;
- `error`: 8 KiB maximum.

Truncated values should end with a clear truncation marker. The full child
transcript, when available, is the source for unbounded detail.

Do not include environment variables, credentials, auth metadata, raw tool
arguments unrelated to the task, or arbitrary child rollout records.

## Upstream-To-ACP Mapping

| Upstream input                          | ACP output                                                                                            |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `spawnAgent`, `inProgress`, no receiver | `action: spawn`, `status: requested`, task/model/reasoning, keyed temporarily by call ID              |
| `spawnAgent`, completed with receiver   | attach `subagentId`; map receiver state to `pending_init` or `running`                                |
| failed spawn                            | `action: spawn`, `status: failed`, with safe error text                                               |
| `subAgentActivity.started`              | `action: activity`, `status: running`, with thread ID and path                                        |
| `subAgentActivity.interacted`           | liveness update; preserve current nonterminal state and update activity time                          |
| `subAgentActivity.interrupted`          | `action: activity`, `status: interrupted`                                                             |
| `sendInput`                             | record an interaction and any returned receiver state; do not render the full input as a new task     |
| `resumeAgent`                           | begin a new running interval for the existing subagent row                                            |
| `wait`                                  | update receiver states/results; do not label a child as waiting merely because the manager is waiting |
| `closeAgent`                            | map the returned receiver state; `shutdown` is distinct from successful completion                    |
| `agentsStates.completed(message)`       | `status: completed`, `result: message`                                                                |
| `agentsStates.errored(message)`         | `status: failed`, `error: message`                                                                    |
| `agentsStates.notFound`                 | `status: not_found`                                                                                   |

The adapter should emit one normalized ACP update per affected receiver. A
single `wait` call involving five subagents therefore updates five logical
rows, rather than exposing a provider-specific multi-receiver payload to the
frontend.

### Idempotence And Replay

Codex may send started, updated, and completed forms of the same item, and a
resumed/replayed thread may expose already-known items again.

The adapter should maintain a per-turn fingerprint of the last normalized
payload for each `(operationId, subagentId)` pair and suppress exact repeats.
The frontend reducer must independently tolerate repeats because persisted logs
can span worker reconnects.

Status is not globally monotonic: `resumeAgent` can move an interrupted or
completed child back to running. The reducer should retain a small lifecycle
timeline and let an explicit resume start a new active interval. It must not
apply a generic "terminal states always win" rule.

## Activity Panel UX

### Placement

Normalize all subagent ACP events into one synthetic `subagents` activity
entry. Insert it at the sequence/time of the first subagent event. Later
updates modify the synthetic view model rather than moving the block or adding
rows throughout the chronological activity list.

Manager reasoning, manager messages, terminal commands, file operations, and
diffs continue to appear chronologically around the block.

### Group Header

The header is always one line and contains:

- label: `Subagents`;
- aggregate state: for example `2 working | 3 done | 1 failed`;
- elapsed time while any child is active;
- expand/collapse affordance.

Status order is severity-first:

1. failed / not found;
2. working / pending;
3. interrupted / shutdown;
4. completed.

Use icons plus text; color alone is not sufficient.

### Expansion Defaults

- While the parent turn is running, default the group to expanded if at least
  one subagent is active or failed.
- For a completed parent turn with no failed subagents, default it to collapsed.
- For a completed parent turn with failures, default it to expanded.
- Persist the user's explicit choice per parent activity log.
- Once the user has explicitly toggled the group, do not automatically change
  it as statuses arrive.

### Compact Rows

Each row shows at most three short lines:

1. status icon, display name, status, and elapsed duration;
2. one-line task excerpt;
3. latest useful result excerpt or `Active N seconds ago` while running.

Display-name priority:

1. final component of `agentPath`;
2. `Subagent 1`, `Subagent 2`, and so on, assigned by first-seen order.

If path-derived names collide, append a short stable thread suffix only to the
duplicates. Do not show UUIDs in every normal row.

Rows should be ordered by first-seen time and remain stable as updates arrive.
Nested subagents may be indented by path depth, capped at two visible levels so
deep trees do not destroy the layout.

Show the first 10 rows initially. If a turn creates more, add `Show N more` and
filters for `Active` and `Failed`. Do not render hundreds of expanded rows by
default.

### Row Details

Expanding one row shows:

- full bounded task text;
- current status and lifecycle transitions with timestamps;
- model and reasoning effort, when provided;
- final result or error;
- agent path;
- copyable child thread ID and operation ID;
- `Open transcript` when the later transcript API is available.

This should be inline disclosure inside Activity, not another modal. A transcript
itself may open in a drawer because it can be long.

### Running Chip

Extend `AgentActivityChip` with a derived subagent summary:

```text
Running 14m | 3 subagents working | activity 4s ago
```

Rules:

- omit the subagent phrase when no subagent event exists;
- use `1 subagent working` for singular;
- if all children are terminal while the manager continues, show a short
  `3 subagents done` until the turn ends;
- failed children use a visible warning, e.g. `1 subagent failed`;
- any accepted subagent lifecycle/activity update refreshes the parent turn's
  backend last-activity time.

This makes parallel work discoverable even when Activity is closed and avoids
incorrectly presenting a working parent as stale.

### Main Chat

No subagent event is published to the live-preview stream as an ACP `message`.
Only manager `message` events contribute to the visible in-progress assistant
text and final response.

The manager may naturally say, for example, "I have three workers checking the
API, UI, and tests." That narrative is valuable and should remain visible. It
is different from exposing raw child messages.

### Markdown Export

`Copy activity as markdown` should export a compact section:

```markdown
- Subagents: 3 total, 2 completed, 1 failed
  - api-audit: completed - Check authorization boundaries
    Result: Found one missing ownership check.
  - tests: failed - Run focused ACP tests
    Error: Test process exited with code 1.
```

Export current state once per subagent, not every raw lifecycle event. Bound
task/result/error excerpts using the same producer limits.

## Frontend View Model

Add a pure reducer, preferably in a small sibling module rather than continuing
to grow `codex-activity.tsx`:

```ts
type SubagentView = {
  key: string;
  subagentId?: string;
  operationIds: string[];
  senderId?: string;
  agentPath?: string;
  displayName: string;
  status: AcpSubagentDisplayStatus;
  task?: string;
  model?: string;
  reasoning?: string;
  result?: string;
  error?: string;
  firstSeenAt?: number;
  lastActivityAt?: number;
  activeSince?: number;
  finishedAt?: number;
  timeline: Array<{
    status: AcpSubagentDisplayStatus;
    action: AcpSubagentAction;
    time?: number;
  }>;
};

type SubagentGroupView = {
  firstSeq: number;
  firstTime?: number;
  active: number;
  completed: number;
  failed: number;
  interrupted: number;
  agents: SubagentView[];
};
```

The reducer must be deterministic and independently testable without React.
It should:

- merge pending spawn rows into real thread rows when the receiver ID arrives;
- deduplicate replays;
- preserve stable first-seen ordering;
- handle child-before-spawn and other out-of-order records;
- represent resume as a new active interval;
- derive group counts;
- derive the most recent backend activity timestamp;
- synthesize nonterminal/unknown state for children still active when the
  parent terminalizes without a child terminal update.

That final condition should render as `status unknown after parent finished`,
not as successful completion.

### Unknown Event Compatibility

Before emitting the new backend event, change the activity normalizer so an
unknown ACP event type is ignored safely. Today the fallback path can turn an
unknown event into a blank `Agent` row. This is undesirable during rolling
deployments and for future schema additions.

Only explicit `message` events should normalize to manager-agent rows.

## Event Volume And Performance

Subagent activity must not turn a parallel run into an unbounded DKV log.

Producer policy:

- always emit spawn metadata once;
- always emit actual state transitions;
- always emit terminal result/error updates;
- suppress exact repeated item snapshots;
- throttle `interacted` liveness events to at most one per subagent every 15
  seconds;
- force a final update regardless of throttle state;
- target no more than roughly 10 lifecycle records per ordinary subagent plus
  throttled liveness records for long-running work.

The existing live stream batching and 30-second durable activity-log
checkpoint remain in place. Subagent events must not trigger SyncDB writes.

Frontend policy:

- reduce the full event list with `useMemo`;
- update existing logical rows rather than mounting one component per raw
  event;
- cap initially visible rows;
- avoid rendering hidden row details;
- preserve the current activity panel's event batching/reconnect behavior.

## On-Demand Child Transcripts

Full transcripts are useful for debugging and expert users, but should be a
second implementation phase.

### Desired UX

`Open transcript` opens a read-only drawer showing the selected child thread's
messages and activity. It is clearly labeled as a subagent transcript and does
not insert those messages into the parent conversation.

The drawer should show:

- child name/path and status;
- task;
- message/activity timeline;
- whether the transcript is live, complete, unavailable, or expired;
- copy transcript action;
- child thread ID in a diagnostic details section.

No steer, interrupt, or resume buttons are included initially. User guidance
continues to go to the manager, which owns coordination. Per-child control can
be considered only after its lifecycle semantics and upstream support are
clear.

### Architecture And Authorization

Add a narrow read-only ACP/project-host API that asks the existing Codex
app-server/session layer for a child thread by ID.

Authorization must verify all of the following:

1. the requester can read the parent `.chat` and its activity log;
2. the child thread belongs to the same Codex root session/turn lineage;
3. the requested child ID appears in an authorized parent subagent event;
4. the current project host owns the live session or can return an explicit
   unavailable/moved result.

The browser calls the project host directly. The hub is not a transcript proxy.
The API must not accept an arbitrary Codex thread ID and return its contents.

Fetch on demand only when the row is opened. For a running child, a low-rate
refresh or a child-specific direct stream may be added later; do not subscribe
to every child transcript when the parent panel opens.

If app-server no longer has the child thread, show the parent-log task/result
metadata and `Full transcript is no longer available`. Do not treat that as a
parent turn failure.

## Files And Responsibilities

### Shared schema

- `src/packages/conat/ai/acp/types.ts`
  - add subagent event/action/status types;
  - keep the change additive.

### Codex adapter

- `src/packages/ai/acp/codex-app-server.ts`
  - recognize `collabAgentToolCall` and `subAgentActivity` items;
  - normalize each affected child to ACP events;
  - merge pending spawn identity;
  - deduplicate repeated snapshots;
  - throttle liveness events;
  - bound task/result/error text.

- `src/packages/ai/acp/__tests__/codex-app-server.test.ts`
  - add fixtures matching current upstream camelCase app-server payloads;
  - verify mapping, deduplication, throttling, nested sender IDs, terminal
    results, errors, interruption, and resume.

### ACP writer

- `src/packages/lite/hub/acp/index.ts`
  - no new transport architecture should be needed;
  - verify subagent events go to the full live/persisted log;
  - verify they do not go to the manager message preview;
  - include them in last-backend-activity derivation;
  - preserve checkpoint/final flush behavior.

- `src/packages/lite/hub/acp/__tests__/chat-writer.test.ts`
  - verify live log, preview exclusion, checkpoint replay, and terminal flush.

### Frontend reducer and rendering

- new `src/packages/frontend/chat/codex-subagents.ts`
  - pure reducer, identity merge, status/timing/count derivation, labels, and
    markdown projection.

- new `src/packages/frontend/chat/codex-subagents.tsx`
  - grouped header, compact rows, details disclosure, responsive rendering.

- `src/packages/frontend/chat/codex-activity.tsx`
  - add the synthetic group entry;
  - explicitly ignore unknown event types;
  - include compact subagent markdown in activity export.

- `src/packages/frontend/chat/agent-message-status.tsx`
  - show aggregate active/done/failed counts in the chip;
  - count subagent updates as backend activity.

- `src/packages/frontend/chat/use-codex-log.ts`
  - likely no protocol change beyond carrying the new typed event;
  - verify reconnect and replay preserve all events.

### Tests

- new `src/packages/frontend/chat/__tests__/codex-subagents.test.ts`
  - reducer and markdown tests.

- new `src/packages/frontend/chat/__tests__/codex-subagents.test.tsx`
  - group/row rendering, expansion defaults, status text, accessibility, and
    large-group behavior.

- extend existing activity and status tests for integration behavior.

## Implementation Phases

### Phase 0: Capture And Lock The Protocol

1. Add synthetic fixtures based on current upstream app-server v2 tests.
2. If practical, capture sanitized notifications from one real local subagent
   turn and retain them as a test fixture.
3. Confirm exact camelCase field names for started, updated, and completed
   items.
4. Confirm which operation reports a child's terminal message when the manager
   does and does not explicitly call `wait`.

Exit criterion: adapter tests describe the real protocol and fail before the
mapping is implemented.

### Phase 1: Schema, Adapter, And Durable Activity

1. Make unknown frontend ACP events harmless.
2. Add the shared event type.
3. Implement app-server mapping, text bounds, deduplication, and throttling.
4. Verify full-log persistence and preview exclusion.
5. Verify subagent events advance parent last-activity time.

Exit criterion: a real turn with subagents produces a compact, replayable typed
event sequence, with manager messages still visible and no blank rows on older
logs.

### Phase 2: Grouped UI

1. Implement the pure reducer.
2. Add the grouped Activity entry and compact rows.
3. Add chip counts and failure warning.
4. Add markdown export.
5. Add responsive and accessibility behavior.

Exit criterion: one, five, and twenty-agent fixtures remain understandable on
desktop and mobile, during the run and after reload.

### Phase 3: On-Demand Transcript Drawer

1. Define the narrow project-host read API.
2. Enforce parent/child/project authorization.
3. Add lazy child-thread fetching.
4. Render a read-only transcript drawer with unavailable/expired states.
5. Add direct project-host and cross-host-restart tests.

Exit criterion: an authorized collaborator can inspect a known child thread
without parent-log bloat or hub proxying, and cannot use the API to enumerate
unrelated threads.

### Phase 4: Production Hardening

1. Add metrics for normalized events, suppressed duplicates, throttled
   liveness events, active children at parent termination, and transcript-read
   failures.
2. Add a live multi-agent smoke to the existing one-turn Chromium harness.
3. Validate app-server reuse, ACP worker drain/restart, browser reload, and
   interrupted parent turns.
4. Tune text limits and liveness cadence from observed logs.

Exit criterion: the feature survives worker/browser reconnects without duplicate
rows or false completion, and event volume stays bounded.

## Test Matrix

### Adapter contract

- spawn starts without a receiver ID, then completes with one;
- spawn fails before a receiver exists;
- child starts before spawn completion is observed;
- multiple children are spawned concurrently;
- child sends several activity signals;
- child completes with a result;
- child errors with a message;
- child is interrupted;
- child is shutdown or not found;
- child is resumed after a terminal state;
- a child spawns a nested child;
- one wait updates several receiver states;
- repeated `item/updated` snapshots are deduplicated;
- app-server replay does not duplicate logical children;
- large task/result/error text is bounded.

### Persistence and reconnect

- live events appear without waiting for parent completion;
- a 30-second checkpoint contains subagent state;
- refresh during a run reconstructs the same group;
- final flush includes the last child result;
- subagent events never enter live manager preview text;
- `.chat` patchflow commit count does not scale with child activity;
- ACP worker drain/restart leaves uncertain children visibly uncertain.

### Frontend

- zero subagents leaves the current UI unchanged;
- one active subagent uses singular copy;
- concurrent children update stable rows in place;
- failures are visible with text and icon, not color alone;
- expansion defaults follow the rules above;
- explicit user collapse remains stable as events arrive;
- duplicate/path-colliding names remain distinguishable;
- nested paths are readable;
- more than 10 children are initially capped;
- unknown future ACP event types produce no blank Agent row;
- markdown contains one current-state entry per child;
- mobile layout does not horizontally overflow.

### Manual lite4b smoke

1. Start a Codex turn that asks for three independent investigations and tells
   the manager to use subagents.
2. Keep Activity closed and verify the running chip shows the active count.
3. Open Activity and verify three stable compact rows.
4. Confirm manager commentary appears in the main chat during the run.
5. Refresh while children are active and verify reconstruction.
6. Interrupt one test run and verify non-success status.
7. Complete a run and verify results/failures remain visible.
8. Copy activity as markdown and inspect the compact export.
9. Run a non-subagent turn and verify no visual regression.

## Rollout Strategy

1. Land unknown-event-safe frontend normalization first or in the same release
   as the schema.
2. Enable adapter emission and grouped rendering on lite4b.
3. Dogfood real multi-agent turns, including refresh and interrupt.
4. Deploy to delta and inspect event cardinality, reconnect behavior, and old
   browser bundles.
5. Deploy to staging, then prod.
6. Keep the event schema additive so rollback only removes rendering; persisted
   events remain harmless.

A site setting is not required for the MVP. If live upstream protocol variance
appears during lite4b testing, add a temporary adapter feature flag rather than
forking the schema or UI.

## Observability

Add structured counters or logs for:

- subagent events accepted by upstream item type/action;
- normalized ACP events emitted;
- exact duplicates suppressed;
- liveness updates throttled;
- active/uncertain children when a parent turn terminalizes;
- malformed upstream payloads;
- child transcript reads by success/unavailable/unauthorized/error.

Do not alert merely because a subagent has been quiet. A child can legitimately
perform a long command. An actionable warning requires stronger evidence, such
as a terminal parent with active children, an app-server error, or a child
explicitly reported as not found.

## Non-Goals For The First Release

- showing every child message in the main chat;
- copying full child transcripts into the parent activity log;
- per-subagent steer, interrupt, resume, or close controls;
- exposing rollout JSONL files to the browser;
- adding a hub transcript proxy;
- changing Codex's own subagent scheduling policy;
- adding subagents as separate `.chat` participants;
- inventing progress percentages that upstream does not provide.

## Acceptance Criteria

The first release is complete when:

1. A user can tell from the closed chip that subagents are active.
2. Opening Activity shows one compact, stable row per subagent.
3. The row explains the task, state, age, and result/error using available
   upstream data.
4. Manager commentary remains visible in the main chat; child chatter does not
   take it over.
5. Refresh/reconnect reconstructs the same state from the persisted ACP log.
6. Duplicate/replayed notifications do not duplicate rows.
7. Failure and uncertain termination remain explicit.
8. Event and `.chat` write volume remain bounded.
9. Unknown event types do not create blank activity rows.
10. The implementation works through the direct project-host ACP path on Lite,
    Launchpad, and Rocket.

The transcript drawer is useful but is not required for the first release. The
schema and row-details affordance should leave a clean path to add it later.
