# Headless Course Application And CLI Architecture Plan

Status: proposed, 2026-08-30.

This plan follows the initial course inspection and configuration commands in
PR 352. That PR intentionally remains a focused support-enabling change. This
document defines the architecture for expanding course CLI and agent support
without creating a second course implementation beside the frontend.

## Objective

Create one headless course application that owns course document semantics and
can be used by:

- the existing browser course UI
- `cocalc project course ...`
- first-party agents acting inside a project
- account-authorized automation
- audited administrator support workflows

The design must preserve the useful property that a `.course` file is a normal
collaborative SyncDB document. Operations that only edit that document should
continue to run through a project connection in the browser or CLI. They must
not be moved into the hub merely to make them available from the CLI.

At the same time, operations that act as an account, affect other projects,
send invitations, or exercise administrator authority must use the appropriate
account or hub services. The shared application must make these authority
requirements explicit before any mutation begins.

## Decision Summary

1. Add `src/packages/apps/course`, published as `@cocalc/app-course`.
2. Put course row types, SyncDB contracts, snapshots, selectors, hashes,
   mutation semantics, and environment-neutral orchestration in that package.
3. Keep React, Redux, dialogs, activity displays, and browser notifications in
   `@cocalc/frontend`.
4. Keep command parsing, auth bootstrap, terminal output, and process behavior
   in `@cocalc/cli`.
5. Keep authorization enforcement, authoritative actor identity, durable audit
   records, cross-project routing, and long-running operations in hub/server
   services.
6. Model operation effects and required authority as separate dimensions.
7. Require a server-derived, durable audit lifecycle for mutating CLI and agent
   course operations.
8. Migrate incrementally. Do not rewrite the complete course UI before adding
   the next support command.

## Current Problem

Course behavior is primarily implemented in
[`frontend/course`](../packages/frontend/course). The first CLI support in PR
352 necessarily introduces similar logic in
[`cli/src/bin/core/project-course.ts`](../packages/cli/src/bin/core/project-course.ts).

The duplicated areas already include or approach:

- SyncDB primary keys and string columns
- conversion of SyncDB values into plain rows
- settings-row selection and normalization
- course settings hashing
- managed-project enumeration
- RootFS settings and project fanout
- course reconfiguration request construction
- persistence of reconfiguration results into the `.course` document

If future commands for adding students, distributing handouts, collecting
assignments, or configuring projects are implemented independently in the CLI,
the browser and CLI will inevitably diverge. Comments linking the two locations
can reduce search cost temporarily, but they do not establish a canonical
implementation.

## Architectural Invariants

### The `.course` document remains authoritative course state

Course settings, students, assignments, handouts, and per-student course state
continue to live in the collaborative `.course` SyncDB document. Opening and
editing that document is valid from either a browser or a CLI project
connection.

Do not add a second relational course model merely to support agents.

### Shared domain logic does not depend on the frontend

`@cocalc/app-course` must not import:

- React
- Redux or Immutable.js
- `@cocalc/frontend`
- browser globals
- command-line parsing or output helpers
- server database implementations

Frontend and CLI code adapt their concrete environments to small contracts
defined by the app package.

### Authentication remains an environment responsibility

`@cocalc/app-course` describes the authority an operation requires and accepts
typed capabilities that satisfy it. It does not read CLI profiles, cookies,
project secrets, browser sessions, or administrator flags.

The caller must acquire the correct capability before invoking the operation.
The server remains the final authorization authority.

### A local account ID is not proof of account authority

The CLI deliberately assigns a fallback account UUID when it is authenticated
only with a project-scoped identity. This allows current-project operations to
use common command plumbing.

Therefore:

- never use the presence of `ctx.accountId` to decide that account authority is
  available
- inspect the authenticated principal and credential class
- let the target server endpoint enforce the same authority independently
- acquire browser-approved account auth before any account operation mutates
  the course document

This is a critical guardrail for all future course CLI work.

### Multibay ownership remains explicit

- The course project's owning bay is authoritative for course-operation audit
  records associated with that project.
- Every managed project operation must route using that project's
  `owning_bay_id` through existing project APIs.
- The app package must not perform direct database access or assume all student
  projects share a bay or host.
- Project file and SyncDB traffic should remain direct to the project host when
  possible; do not proxy it through the hub for convenience.

### Cross-project reliability is not a browser loop

Bounded one-off project calls can be orchestrated through injected services.
Large, resumable, or failure-prone fanout should use an authoritative LRO. In
particular, assignment distribution and collection should follow
[`course-copy-collection-plan-2026-05-12.md`](./course-copy-collection-plan-2026-05-12.md).

## Two Independent Operation Dimensions

Every operation must declare both its effect class and its authority class.
These are related, but they are not the same thing.

### Effect classes

| Effect class | Meaning                                                       | Typical execution path                       |
| ------------ | ------------------------------------------------------------- | -------------------------------------------- |
| `document`   | Reads or changes only the `.course` SyncDB                    | Direct project SyncDB session                |
| `project`    | Changes one managed project's metadata or runtime             | Bay-aware project RPC                        |
| `fanout`     | Coordinates multiple managed projects                         | Hub LRO or bounded project RPC orchestration |
| `external`   | Sends email, creates an invite, or affects billing/membership | Account-authorized hub service               |
| `support`    | Overrides ordinary user workflow to resolve a customer issue  | Admin fresh-auth service with reason         |

### Authority classes

| Authority       | Meaning                                                             | Examples                                                                   |
| --------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| `project`       | Current-project credential is sufficient                            | Show course state; change title or description; edit a local setting       |
| `account`       | A real account or short-lived delegated account session is required | Add/invite a student; create or configure student projects; collect work   |
| `account-fresh` | The user's account session must satisfy a recent challenge          | Reserved for genuinely dangerous user actions, not ordinary course editing |
| `admin-fresh`   | Site administrator with recent 2FA and an audit reason              | Customer support intervention or policy override                           |

Initial operation classification:

| Operation                                              | Effect                         | Minimum authority                              |
| ------------------------------------------------------ | ------------------------------ | ---------------------------------------------- |
| List/find `.course` files                              | `document`                     | `project`                                      |
| Show settings and counts                               | `document`                     | `project`                                      |
| Change title or description                            | `document`                     | `project`                                      |
| Change a persisted project default without applying it | `document`                     | `project`                                      |
| Add or invite students                                 | `document` + `external`        | `account`                                      |
| Remove or undelete students                            | `document`, possibly `project` | `account`                                      |
| Create/reconfigure student projects                    | `fanout`                       | `account`                                      |
| Apply RootFS and restart active projects               | `fanout`                       | `account`                                      |
| Distribute an assignment or handout                    | `fanout`                       | `account`                                      |
| Collect an assignment                                  | `fanout`                       | `account`                                      |
| Change course billing or membership policy             | `external`                     | endpoint-specific, potentially `account-fresh` |
| Administrator repair for a support ticket              | any                            | `admin-fresh`                                  |

This table is an initial policy inventory. Each server endpoint remains
responsible for enforcing its actual policy, and any stronger endpoint policy
wins.

Authority is cumulative rather than substitutive. `account` means an
authenticated account that also has the required access to the course project
and affected resources. It does not mean that any signed-in account may act on
any course. `admin-fresh` may bypass ordinary collaboration only through an
explicit support endpoint whose policy and audit record authorize that bypass.

## Package Design

Create:

```text
src/packages/apps/course/
  package.json
  tsconfig.json
  src/
    index.ts
    contracts/
      authority.ts
      audit.ts
      document.ts
      services.ts
    model/
      rows.ts
      snapshot.ts
      selectors.ts
      settings.ts
      hashes.ts
    session/
      syncdb.ts
    operations/
      settings.ts
      students.ts
      reconfigure.ts
      rootfs.ts
      assignments.ts
      handouts.ts
  test/
    ...
```

Start smaller if appropriate, but preserve these conceptual boundaries.

Suggested package metadata:

```json
{
  "name": "@cocalc/app-course",
  "description": "Headless course document operations for CoCalc"
}
```

The initial dependency set should be narrow:

- `@cocalc/util` for stable course path and schema utilities
- `@cocalc/conat` only for shared public request/result types when useful
- `@cocalc/sync` only if the concrete reusable SyncDB session requires it

Prefer app-owned minimal interfaces over importing large client or frontend
objects.

## Core Contracts

The exact names may change during implementation. The important requirement is
that the boundaries remain explicit.

### Document session

```ts
export interface CourseDocumentSession {
  readonly projectId: string;
  readonly path: string;

  getSnapshot(): CourseSnapshot;
  getSettingsHash(): string;
  getRow(key: CourseRowKey): CourseRow | undefined;

  commit(
    mutations: readonly CourseMutation[],
    options: CourseCommitOptions,
  ): Promise<CourseCommitResult>;

  close(): Promise<void>;
}
```

The SyncDB implementation should centralize:

- primary keys
- string columns
- ready/error/close behavior
- conversion from Immutable.js or SyncDB values into plain rows
- expected-hash checks
- commit, save, and save-to-disk behavior
- post-commit verification

Do not put project-client discovery into the session. The frontend and CLI each
already know how to obtain a routed project Conat client and should inject the
created SyncDB.

### Authority declaration

```ts
export type CourseAuthorityRequirement =
  | "project"
  | "account"
  | "account-fresh"
  | "admin-fresh";

export interface CourseOperationDefinition {
  name: CourseOperationName;
  effect: CourseEffectClass;
  authority: CourseAuthorityRequirement;
  mutatesDocument: boolean;
  supportsPreview: boolean;
}
```

Keep a single operation registry in `@cocalc/app-course`. The CLI can use it for
preflight and help output, but it must not treat that metadata as server-side
authorization.

### Injected service capabilities

```ts
export interface CourseProjectServices {
  getProjectState(projectId: string): Promise<ProjectState>;
  setProjectRootfs(input: SetProjectRootfsInput): Promise<RootfsState[]>;
  restartProject(projectId: string): Promise<ProjectRestartResult>;
}

export interface CourseAccountServices extends CourseProjectServices {
  reconfigureCourse(input: CourseReconfigureRequest): Promise<CourseLro>;
  inviteStudent(input: CourseStudentInvite): Promise<CourseInviteResult>;
  copyToProjects(input: CourseDistributionRequest): Promise<CourseLro>;
  collectFromProjects(input: CourseCollectionRequest): Promise<CourseLro>;
}

export interface CourseAdminServices extends CourseAccountServices {
  readonly supportReason: string;
  readonly supportReference?: string;
}
```

These interfaces represent capabilities already obtained by the caller. A
project-only operation must not accept a giant service object merely because it
is convenient. An account operation must require account services before it
changes the document.

### Pure model and selectors

The app package should own deterministic functions for:

- normalizing course rows
- producing a `CourseSnapshot`
- selecting active/deleted students
- selecting managed student, shared, and external nbgrader project IDs
- deriving RootFS and host settings
- deterministic settings and snapshot hashes
- constructing mutations and before/after summaries
- constructing reconfiguration input from explicit environment values

The frontend may convert an Immutable.js store into a plain snapshot during the
migration, but selector semantics must become canonical in the app package.

## Frontend Adapter

The frontend keeps responsibility for:

- opening the project through `webapp_client`
- Redux/Immutable.js state and compatibility while migration is incomplete
- activity indicators and per-item progress
- dialogs, confirmation, errors, and notifications
- deciding when to invoke an operation based on user interaction
- observing LRO progress and projecting it into the course UI

Frontend actions should become thin adapters:

1. Obtain or construct the shared course snapshot/session.
2. Provide browser implementations of the required service contracts.
3. Invoke the shared operation.
4. Project the typed result into Redux and UI state.

Once `@cocalc/app-course` exists, place comments in the major legacy course
action entry points stating that new course semantics belong in the app package.
Do not add comments before the canonical implementation exists, since a comment
pointing at a plan is weaker than a real import boundary.

## CLI Adapter And Authorization Flow

The CLI owns credential discovery and must preflight an operation before any
document mutation.

### Principal detection

Normalize the current CLI identity into an explicit shape such as:

```ts
export type CliCoursePrincipal =
  | { kind: "project"; projectId: string; tokenFingerprint?: string }
  | { kind: "account"; accountId: string; sessionHash?: string }
  | {
      kind: "delegated-agent";
      accountId: string;
      projectId: string;
      tokenFingerprint: string;
      expiresAt: number;
    }
  | { kind: "admin"; accountId: string; freshUntil?: string };
```

Do not infer this union from `ctx.accountId`. Use authenticated remote metadata
and server validation.

### Project-authorized operation

For an operation requiring only `project` authority:

1. Confirm project-scoped credentials target the same course project.
2. Open the `.course` SyncDB directly through the routed project client.
3. Begin the durable audit when the command is mutating.
4. Apply the shared document operation with an expected hash.
5. Save and verify the resulting hash.
6. Complete the audit.

No account login should be required merely to change a description or inspect
the course document.

### Account-authorized operation from a project agent

When an agent in a project invokes an `account` operation:

1. Parse and validate the complete command without mutating anything.
2. Open/read the course only as needed to produce a preview and expected hash.
3. Detect that the current principal is project-scoped.
4. Explain that temporary account approval is required.
5. Start the existing browser-approved short-lived account bootstrap flow when
   interactivity is allowed.
6. Have the user approve the displayed browser link.
7. Reconnect using the temporary cookie-backed account context.
8. Re-read the course and compare its current hash with the reviewed hash.
9. Begin the audit, then perform the operation from the beginning.
10. Destroy the ephemeral local auth profile when the command completes.

Generalize the existing short-lived project-to-account authorization helper
instead of implementing a course-specific login mechanism.

Never write a student row first and ask for account authorization afterward.
Authority acquisition is part of preflight.

### Fresh auth

Ordinary account course operations should not automatically require fresh 2FA.
Use fresh auth only when the underlying server policy classifies the action as
dangerous.

When the server returns `fresh_auth_required`, use the existing
`cocalc auth elevate` browser workflow and retry only after re-reading and
revalidating the course hash.

### Administrator support operation

Administrator repair must not silently impersonate the customer.

Requirements:

- authenticated administrator identity
- fresh auth enforced server-side
- a non-empty human-readable reason
- a support reference when available, for example `Zendesk #20644`
- server-derived actor identity in the audit record
- explicit result showing which customer projects or course rows changed

Representative CLI shape:

```text
cocalc project course ... --support-reason "Resolve Zendesk #20644" --commit
```

Whether this uses an admin-specific RPC or a scoped support grant should be
decided during the audit phase. In either case, the record must distinguish the
administrator from the course owner.

## Audit Architecture

SyncDB/Patchflow metadata is valuable for document history, but it is supplied
by the client and is not an authoritative security audit. Mutating CLI and
agent operations need a durable server-side record whose actor comes from the
authenticated request context.

### Audit ownership

Store course-operation audit records on the course project's owning bay. Route
all begin/read/finish calls by `course_project_id`; do not assume the caller's
home bay owns the record.

### Audit lifecycle

Use a two-stage lifecycle because a SyncDB commit and a server audit write
cannot share one database transaction:

1. `started`: recorded before mutation
2. `succeeded` or `failed`: recorded after save and verification

If a process crashes, a durable `started` event remains. A reconciliation job
or later inspection may mark old records `abandoned`, but it must not erase
them.

For CLI and agent mutations, failure to begin the authoritative audit should
fail closed before changing course state. Existing browser offline editing must
not be broken by this requirement; browser audit adoption can be phased in
separately with explicit offline semantics.

### Suggested audit record

```ts
export interface CourseOperationAuditRecord {
  audit_id: string;
  course_project_id: string;
  course_path: string;
  operation: string;
  status: "started" | "succeeded" | "failed" | "abandoned";

  actor_account_id?: string;
  actor_kind: "account" | "delegated-agent" | "project" | "admin";
  auth_session_id?: string;
  api_key_id?: string;
  token_fingerprint?: string;

  source: "cli" | "agent" | "browser" | "server";
  source_version?: string;
  reason?: string;
  support_reference?: string;
  idempotency_key: string;

  expected_document_hash?: string;
  before_document_hash?: string;
  after_document_hash?: string;
  target_project_ids?: string[];
  lro_op_ids?: string[];
  summary?: Record<string, unknown>;
  error?: string;

  created_at: string;
  completed_at?: string;
}
```

Do not persist raw email messages, assignment contents, student files, or
unbounded course rows in audit metadata. Store identifiers, bounded summaries,
and hashes.

Do not store raw cookies, bearer tokens, API keys, or session hashes. A bounded
server-derived identifier or fingerprint is sufficient.

### Audit API

Representative project APIs:

```ts
beginCourseOperationAudit(input): Promise<{ audit_id: string }>;
completeCourseOperationAudit(input): Promise<CourseOperationAuditRecord>;
listCourseOperationAudit(input): Promise<CourseOperationAuditPage>;
```

Server requirements:

- derive actor fields from auth context
- reject an actor kind claimed by the client
- enforce course-project access before begin/read
- require fresh admin auth and reason for support operations
- route to the owning bay
- cap metadata and result sizes
- make begin idempotent by caller-provided idempotency key
- allow completion only by the same authenticated principal or an internal
  reconciliation worker
- retain failed and abandoned records

### Linking document history and audit history

The SyncDB commit metadata should include only safe correlation information:

```ts
{
  action: "course.students.add",
  audit_id: "...",
  operation_id: "..."
}
```

The authoritative server record stores the actor. Document metadata makes it
easy to connect a time-travel revision to that record but is not trusted as the
record itself.

### Side effects and LROs

One top-level course command should have one audit ID even if it creates
multiple LROs. Record all LRO IDs and bounded per-target outcomes on completion.
The LROs retain their own operational histories; the course audit explains why
they were launched and by whom.

## Concurrency, Preview, And Idempotency

Mutating agent workflows must be reviewable and safe against concurrent browser
edits.

### Expected hashes

- Read operations return deterministic settings/document hashes.
- A mutation preview records the relevant expected hash.
- After temporary auth or fresh-auth elevation, re-read the document.
- Reject stale execution before mutation if the expected hash changed.
- Return the new hash after save and verification.

Use a settings hash for settings-only operations and a broader snapshot hash
when student/assignment rows matter.

### Preview and commit

Account, fanout, and support operations should support a preview/apply split
where practical:

```text
cocalc project course students add class.course students.csv
cocalc project course students add class.course students.csv --commit \
  --expected-snapshot-hash sha256:...
```

Exact CLI spelling can follow existing command conventions. The important
properties are:

- preview makes no mutation or external side effect
- output states required authority
- output lists bounded affected IDs/counts
- commit requires the reviewed hash
- retries carry an idempotency key

Simple project-only edits may remain one-step commands when their impact is
obvious, but they still use expected hashes when supplied by an agent.

### Partial failure

Shared operations must return structured per-target results. Never report a
bulk operation as simply successful if some managed projects failed.

For resumable operations:

- persist the top-level LRO
- report failed targets
- support retrying failed targets without repeating successful side effects
- keep the same parent audit correlation where appropriate, or link a retry
  audit to the original audit ID

## What Belongs In The Hub

Use the hub/server when an operation requires:

- account identity or invitation delivery
- authoritative authorization across projects
- project creation, collaborator changes, runtime changes, or billing policy
- multibay routing
- durable audit identity
- bounded concurrency, retries, or work after the browser/CLI disconnects
- a resumable LRO

Examples:

- course project reconfiguration
- RootFS selection and restart for managed projects
- assignment distribution fanout
- assignment collection
- support override

The hub should receive explicit normalized input from the app operation. It
should not become the owner of the `.course` SyncDB lifecycle.

## What Stays In The Browser Or CLI

Keep these close to the project document:

- opening and reading the `.course` SyncDB
- deterministic snapshot construction
- settings changes that only modify that document
- adding/removing local course rows after authority preflight
- expected-hash checks
- writing LRO results back into course rows
- save and post-save verification

Both environments should use `@cocalc/app-course` for these semantics.

## Migration Plan

### Phase 0: Preserve PR 352 and document the destination

- [x] Keep the support-enabling course CLI implementation focused and
      reviewable.
- [x] Record this architecture before adding broad course commands.
- [ ] Do not add another substantial course command directly to
      `frontend/course` or `cli/src/bin/core/project-course.ts` without first
      creating the shared package boundary.

### Phase 1: Scaffold `@cocalc/app-course`

- [ ] Add package metadata, TypeScript references, exports, and focused tests.
- [ ] Define row types, primary keys, string columns, normalization, snapshots,
      settings selection, hashes, and managed-project selectors.
- [ ] Define effect and authority registries.
- [ ] Define minimal document and service contracts.
- [ ] Add a package README identifying it as the canonical location for new
      course semantics.

Acceptance gate:

- package builds independently
- pure selectors have fixture coverage for active/deleted students, shared
  projects, nbgrader, malformed legacy rows, and duplicate IDs
- package has no frontend, CLI, browser, or server implementation dependency

### Phase 2: Shared SyncDB session

- [ ] Implement a `SyncDBCourseSession` following the pattern in
      `@cocalc/app-notebook` and `@cocalc/app-tasks`.
- [ ] Move ready/error/close behavior and row conversion into the session.
- [ ] Implement expected-hash mutation, commit, save, save-to-disk, and
      verification helpers.
- [ ] Adapt the CLI to use the shared session.
- [ ] Adapt the frontend sync layer incrementally without changing Redux state
      shape yet.

Acceptance gate:

- browser and CLI read identical snapshots and hashes from the same fixture
- a mutation made through either adapter appears identically in the document
- concurrent expected-hash mismatch fails before mutation

### Phase 3: Extract current duplicated operations

- [ ] Move reconfiguration request construction into the app package.
- [ ] Move managed-project enumeration and RootFS orchestration into the app
      package.
- [ ] Move application of reconfiguration results to course rows into the app
      package.
- [ ] Replace frontend and CLI implementations with imports and thin adapters.
- [ ] Add cross-adapter contract tests.
- [ ] Add comments to remaining legacy frontend action entry points pointing to
      `@cocalc/app-course` as canonical.

Acceptance gate:

- one implementation of each extracted semantic remains
- current browser behavior and PR 352 command behavior remain unchanged
- RootFS application uses bay-aware services and restarts only active projects

### Phase 4: Explicit CLI authority preflight

- [ ] Add normalized principal detection that distinguishes project, account,
      delegated agent, and administrator credentials.
- [ ] Generalize the existing ephemeral browser-approved account bootstrap for
      project-launched commands.
- [ ] Bind every course command to its operation definition.
- [ ] Reject insufficient authority before mutation.
- [ ] Re-read and revalidate expected hashes after auth changes.
- [ ] Improve JSON and human output with required/actual authority.

Acceptance gate:

- project credentials can change a course description in their own project
- project credentials cannot add a student without temporary account approval
- approved temporary account auth retries safely and is removed afterward
- `ctx.accountId` fallback cannot accidentally satisfy account preflight

### Phase 5: Durable audit service

- [ ] Add owning-bay course audit schema and API.
- [ ] Implement server-derived principal classification.
- [ ] Add begin/complete/list with idempotency and bounded metadata.
- [ ] Require audit begin for mutating CLI/agent operations.
- [ ] Link safe audit IDs into SyncDB metadata and LRO inputs.
- [ ] Add `project course audit list` and structured output.
- [ ] Define retention and abandoned-operation reconciliation.

Acceptance gate:

- each mutating CLI operation has one durable audit record
- actor identity cannot be forged through request fields or SyncDB metadata
- admin support records include admin actor, fresh-auth validation, and reason
- multibay tests prove records live on and route to the owning bay
- failed and interrupted operations remain visible

### Phase 6: Add future commands as vertical slices

Implement each feature in this order:

1. shared app operation and tests
2. service contract or existing RPC adapter
3. frontend adapter migration for the same semantic
4. CLI command and authority preflight
5. audit integration
6. browser/CLI parity tests

Suggested early slices:

- [ ] set title and description (`project` authority)
- [ ] add students from email/CSV (`account` authority)
- [ ] remove/undelete students (`account` authority)
- [ ] distribute a handout (`account` + fanout LRO)
- [ ] distribute an assignment (`account` + fanout LRO)
- [ ] collect an assignment (`account` + collection LRO)

Do not implement a CLI-only semantic and leave the frontend on an unrelated
implementation.

## Testing Strategy

### App package unit tests

- row normalization and legacy compatibility
- deterministic snapshots and hashes
- settings and student mutations
- managed-project selection
- operation authority metadata
- RootFS active/stopped behavior with fake services
- reconfiguration request/result mapping
- idempotent retries and partial results

### Adapter contract tests

Run the same operation fixtures through:

- in-memory session
- SyncDB session
- frontend snapshot adapter
- CLI adapter

Assert equivalent document mutations and result summaries.

### CLI auth tests

- project principal on matching and non-matching course projects
- account cookie session
- delegated agent session
- account API key with insufficient capability
- project fallback account UUID does not pass account preflight
- temporary browser authorization accepted, canceled, expired, and stale
- fresh-auth required and completed
- non-interactive environment emits a usable approval instruction without
  partially mutating state

### Audit tests

- authoritative actor derived server-side
- forged actor/reason metadata rejected or ignored
- begin is idempotent
- completion principal matches begin principal
- status transitions are append-only or otherwise tamper-evident
- metadata size and secret redaction limits
- failed and abandoned records
- audit/document correlation ID
- audit/LRO correlation
- owning-bay routing from a different home bay

### End-to-end parity tests

For each migrated vertical slice:

1. Create equivalent fixture courses.
2. Perform the operation through the browser adapter and CLI adapter.
3. Compare normalized snapshots and side-effect requests.
4. Verify activity/audit output.
5. Reopen the course and confirm convergence.

## CLI UX Guidelines

- Read commands should work with project-scoped credentials whenever the
  current project is sufficient.
- Every mutation should print or return the course project ID and normalized
  course path.
- JSON output must include authority used, audit ID, before/after hashes, LRO
  IDs, affected counts, and per-target failures when applicable.
- Human output must clearly distinguish persisted configuration from applied
  project state.
- Preview output must state that no mutation occurred.
- Never claim an operation was applied merely because its configuration was
  persisted.
- Never hide temporary-auth requirements behind a generic permission error.
- Never silently switch from project credentials to a powerful ambient account
  or administrator credential.
- Administrator mutations require an explicit reason and should show the
  resulting audit ID prominently.

## Rollout And Compatibility

- Keep existing frontend behavior working throughout migration.
- Do not change the `.course` file schema solely for package extraction.
- Preserve unknown legacy row fields when updating known fields.
- Avoid large one-shot movement of the assignment action implementation.
- Move one semantic at a time and leave compatibility adapters where needed.
- Remove duplicated code only after both frontend and CLI consume the shared
  implementation and parity tests pass.
- Update this plan's phase checklist as work lands.

## Non-Goals

- Replacing the `.course` SyncDB with PostgreSQL tables.
- Moving all course actions into the hub.
- Making the hub proxy project SyncDB or file traffic.
- Rewriting the entire Redux course UI before adding useful CLI commands.
- Granting project agents implicit account authority.
- Treating API keys or bearer tokens as fresh-auth credentials.
- Treating client-supplied Patchflow metadata as an authoritative actor log.
- Creating a browser-dependent CLI protocol.
- Reimplementing distribution or collection as unbounded CLI loops.

## Guidance For Future Agents

Before adding or changing a course operation:

1. Read this document.
2. Read [`scalable-architecture.md`](./scalable-architecture.md).
3. Identify both the operation effect and minimum authority.
4. Determine which bay owns each authoritative action or record.
5. Search `@cocalc/app-course` first.
6. Put new deterministic course semantics there.
7. Keep frontend and CLI code as adapters.
8. Enforce permissions on the server even if the CLI preflights them.
9. Add or extend the durable audit path for mutations.
10. Add parity tests before deleting legacy behavior.

If `@cocalc/app-course` does not yet exist when the next broad command is
requested, Phase 1 is part of that command's implementation. Do not continue
growing parallel frontend and CLI course cores.

## Completion Criteria

This architecture is established when:

- `@cocalc/app-course` is the documented and imported canonical course domain
  package
- frontend and CLI share document schema, snapshots, hashes, selectors, and
  migrated operation semantics
- project-only operations work without account login
- account operations acquire and verify account authority before mutation
- administrator support uses fresh auth and an explicit reason without silent
  customer impersonation
- every mutating CLI/agent operation has a server-derived durable audit record
- multibay routing is covered for course audit and managed-project operations
- adding a new course command does not require copying a frontend action
