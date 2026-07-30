# Project-Host Quota Lifecycle and Startup Scalability Plan

Date: 2026-07-30

Status: core implementation deployed and stress-tested on staging; no
production changes authorized

Related plan:

- `src/.agents/project-host-io-phase-2-plan-2026-07-29.md`

## Implementation and Staging Evidence

### Completed on 2026-07-30

The core lifecycle/startup implementation is committed on branch `ops`:

- `71da6b9b8b` targets project quota reads instead of enumerating all qgroups;
- `44d895ce7a` adds durable priority, attribution, timing, aging, and
  coalescing to quota work;
- `595b9fee85` adds owning-bay revisions and the host desired/applied ledger;
- `f82e37f719` removes RootFS and port-allocation population scans from start
  and replaces full quota repair with a bounded cursor auditor;
- `45fbf0b71a` adds a host-ID-gated, exactly reversible staging corpus tool;
- `95e63a4421` prepares scratch asynchronously after stop and retains a
  synchronous fail-closed start fallback;
- `cb0352d0ab` makes deletion win races with background scratch preparation by
  using per-project lifecycle serialization and invalidation generations.

Validation completed:

- project-host: 106 suites and 660 tests passed;
- project-runner: 14 suites and 92 tests passed;
- focused server quota/revision tests: 28 tests passed;
- project-host, project-runner, server, database, and Conat package
  typechecks/builds passed;
- deterministic 10K-row SQLite port lease and quota-auditor tests passed.

### Staging Deployment

The final staging artifact is:

```text
20260730T223250Z-cb0352d0-quota-startup-20260730-cb0352d
```

Deployment record:

```text
20260730T224446Z-20260730T223250Z-cb0352d0-quota-startup-20260730-cb0352d
```

The rollout used `host2` as a 60-second canary, then rolled the second staging
host with concurrency one and a 30-second stabilization period. Both hosts
passed. The project-host staging smoke test passed representative-host,
deployment-version, and RootFS RPC checks. Both public `/healthz` routes
reported ready with the correct host identity.

No production API, host, database, DNS, or storage resource was touched.

### 10K Population Test

The staging corpus on `host2` contained:

```text
10,000 synthetic dormant project rows
10,000 synthetic project subvolumes
10,162 total host subvolumes
10,169 total host qgroups
```

The corpus tool reserves UUIDs under
`70000000-0000-4000-8000-*`, records a durable marker, verifies the installed
host ID, and deletes only its reserved rows and paths during cleanup.

The owning bay correctly classifies host-local fake volumes as stale. To
prevent that cleanup from contaminating the scalability measurement, the test
temporarily changed only `host2`'s provisioned-inventory interval, restarted
the project-host with no corpus present so its initial inventory was clean,
then seeded the corpus. The temporary override and all 10K rows/subvolumes were
removed after the test.

This isolation is required for future repetitions. An unisolated inventory
test caused the host to delete more than 1,000 fake projects per minute,
raising CPU and I/O pressure and producing invalid 12-13 second startup
samples. Those samples measure deliberate orphan reclamation, not startup
complexity.

### Measured Result

The same disposable project was stopped and cold-started repeatedly with the
full corpus present. Ten clean samples on the pre-race-guard artifact produced:

```text
phase                         mean       median      min       max
control total                 2265.6 ms  2242.5 ms   2110 ms   2473 ms
project-host total            2011.9 ms  1969.5 ms   1899 ms   2241 ms
quota check                     74.0 ms    70.5 ms     60 ms    108 ms
runner start                  1879.5 ms  1825.5 ms   1775 ms   2073 ms
Podman run                     818.2 ms   781.0 ms    747 ms    981 ms
```

Five final-artifact samples were then taken while BEES was actively generating
background small-write pressure:

```text
phase                         mean       median      min       max
control total                 2379.4 ms  2371 ms     2220 ms   2638 ms
project-host total            2095.6 ms  2019 ms     1952 ms   2368 ms
quota check                     86.2 ms    82 ms        77 ms    102 ms
runner start                  1959.4 ms  1896 ms     1836 ms   2225 ms
Podman run                     823.2 ms   791 ms      771 ms    946 ms
```

Before post-stop preparation, the same project's quota phase was 521-1055 ms
and project-host total was 2770-3552 ms. The final quota phase remained bounded
at 77-102 ms with 10K unrelated project volumes and active background I/O.
This is direct evidence that normal unchanged startup no longer performs a
whole-filesystem quota operation.

### Additional Finding

Creating or deleting 10K Btrfs subvolumes/qgroups creates substantial
short-lived kernel I/O pressure. Repeated unfiltered `btrfs qgroup show` from a
test observer also sustained pressure and must not be used as a frequent
metric. BEES ran in `/cocalc-bees` with I/O weight 1 and a bandwidth cap, but
had no IOPS cap and generated hundreds of small writes per second against the
fresh corpus. Startup remained near two seconds internally, so this does not
block the core result, but BEES IOPS policy remains a separate follow-up.

### Remaining Before Production Review

The following plan items are not complete and must not be implied by the
staging latency result:

- replace the process-local quota epoch with durable filesystem identity and
  quota-mode epoch handling;
- persist and verify stable Btrfs volume identity for applied ledger claims;
- migrate every temporary quota raise to the durable override model;
- complete operator diagnostics for desired/applied revision, identity, epoch,
  queue state, and fast-path status;
- add or verify lifecycle-context guards for every unfiltered global Btrfs
  command;
- decide whether BEES needs an explicit IOPS ceiling;
- review all remaining recurring full-host loops and either bound, index, or
  isolate them;
- perform an explicit production-readiness review and obtain separate
  production authorization.

## Executive Decision

Implement the quota lifecycle queue and remove host-wide work from project
startup before pursuing additional project-start optimizations.

The implementation must satisfy two requirements:

1. Quota work needed by project lifecycle operations is durable,
   lifecycle-aware, coalesced, observable, and served ahead of maintenance
   work without losing correctness after a crash.
2. A project start performs no operation whose cost grows with the number of
   projects, containers, subvolumes, qgroups, or snapshots hosted elsewhere on
   the machine.

The design will be completed and qualified on staging before production is
touched. Staging qualification must include a dedicated disposable host with
at least 10,000 assigned projects and enough real subvolumes and qgroups to
expose accidental whole-filesystem operations.

Production rollout is explicitly outside the implementation and staging phase.
It requires a separate review and explicit approval after the staging evidence
is complete.

## Scope

This plan covers:

- authoritative desired quota state and monotonic revisions;
- a durable host-local desired/applied quota ledger;
- targeted quota observation;
- quota-mode and volume-identity invalidation;
- lifecycle-aware durable quota scheduling;
- priority, fairness, starvation aging, and coalescing;
- durable operation attribution and timing;
- crash-safe temporary quota overrides;
- removal of unconditional runner quota writes;
- asynchronous home and scratch preparation;
- replacement of synchronous full quota repair with a bounded drift auditor;
- elimination of direct startup-path work that scales with hosted projects,
  including RootFS usage scans and first-time port lease allocation;
- isolation or incremental replacement of concurrent host-wide background loops
  that can interfere with project starts;
- a 10,000-project staging scalability and fault-injection campaign;
- a compatibility-first, single-artifact production rollout design for later
  use.

This plan does not cover:

- changing project CPU or memory scheduling;
- a broader redesign of storage admission;
- changing project idle-stop policy;
- membership-tier storage policy;
- weighted I/O policy beyond the containment already deployed;
- production deployment or production data mutation;
- frontend work except minimal operator observability if required.

Those remain possible later phases. They should not be used to compensate for
an O(N) or non-durable startup path.

## Why This Work Comes First

The current implementation solved an immediate correctness problem by
serializing Btrfs quota mutations. Serialization prevents concurrent qgroup
commands from colliding, but it does not distinguish a user waiting for a
project start from an hourly repair task. It also does not coalesce repeated
writes, persist operation identity, or separate queue wait from command time.

The current startup path is additionally over-defensive in a way that becomes
expensive at scale:

- it re-reads live Btrfs quota state;
- the read can enumerate all qgroups on the filesystem;
- it may write an unchanged quota;
- the runner writes home and scratch quotas again;
- each write invalidates the short-lived whole-filesystem qgroup cache;
- repair work independently repeats similar validation;
- RootFS accounting and first-time port allocation contain additional
  host-wide scans.

The correctness checks are justified. Their implementation is not. The
replacement must preserve the restored-project quota regression fix and the
repair guarantees while making the normal unchanged start path bounded and
cheap.

## Non-Negotiable Invariants

### Authority

1. The owning bay's PostgreSQL project record is the authoritative source for
   the desired persistent project quota.
2. Every persistent desired quota change has a monotonic revision allocated by
   the owning bay.
3. Host SQLite is the durable enforcement ledger. It records desired state
   received by the host and the last state successfully applied to a specific
   volume identity and quota epoch.
4. Btrfs is observed enforcement state, not desired state.
5. Runner configuration is transport for a start, not an independent source of
   quota truth.
6. No code may mutate a persistent project quota directly in Btrfs without
   first durably recording the desired state or an explicit temporary override.

### Startup Complexity

1. No project start may enumerate all assigned projects.
2. No project start may enumerate all containers.
3. No project start may enumerate all Btrfs subvolumes.
4. No project start may enumerate all qgroups.
5. No project start may enumerate snapshots belonging to other projects.
6. Work proportional to the starting project's own explicitly requested data
   is allowed only when unavoidable and measured.
7. Host startup and readiness must not wait for a complete quota repair or
   filesystem inventory.

### Durability and Ordering

1. A process crash after desired state is accepted must not lose the required
   quota mutation.
2. A process crash after the Btrfs command succeeds but before SQLite is
   updated must converge safely by idempotent replay.
3. A stale or reordered RPC must not overwrite a newer desired revision.
4. Repeated requests for the same logical volume must converge to the newest
   desired revision without executing every intermediate write.
5. Lifecycle work must be served ahead of maintenance work.
6. Maintenance must eventually run when the host is healthy and lifecycle load
   permits it.
7. Every operation must retain project, operation, class, and timing
   attribution across queueing and process restart.

### Safety

1. Quota paths and volume identities are derived from trusted host metadata,
   never accepted as arbitrary paths from a remote RPC.
2. Quota decreases below current usage remain blocked with a clear error.
3. Quota increases needed to start a restored or enlarged project are applied
   before the usage/headroom decision.
4. Restore, clone, snapshot cleanup, volume replacement, host rehome, and quota
   mode changes invalidate stale applied-state claims.
5. Existing project containers must not be restarted merely to deploy this
   machinery.

## Current-State Findings

### Desired State Has No Revision

`src/packages/server/projects/control/base.ts` writes `projects.run_quota`.
For an inactive project it can stop after the database update. For an active
project it forwards the new value to the project host.

There is no monotonic quota revision. The host therefore cannot distinguish a
late old message from the newest desired value.

### Host SQLite Is a Cache, Not an Enforcement Ledger

`src/packages/project-host/sqlite/projects.ts` stores project metadata,
including `run_quota`, `disk`, and `scratch`. It does not store:

- desired quota revision;
- applied quota revision;
- volume identity;
- filesystem identity;
- quota epoch;
- application state and last error.

Consequently, the host cannot safely skip a live Btrfs check even when nothing
changed.

### Startup Reads and Writes Live Quota

`src/packages/project-host/hub/projects.ts` performs a pre-start disk-quota
check. It reads the live home quota, checks requested quota against usage, and
raises a missing or smaller live limit before start.

That check fixed a real regression: a restored project using roughly 57 GB
could be blocked by an old 50 GB Btrfs limit even after its requested quota was
raised to 65 GB. The replacement must preserve this behavior.

### Quota Reads Can Enumerate the Filesystem

`SubvolumeQuota.get` resolves a subvolume ID and then uses
`cachedBtrfsQgroupShowRaw(mount)`.

`src/packages/project-host/file-server/btrfs/operation-cache.ts` runs:

```text
btrfs qgroup show -prc --raw <mount>
```

This enumerates all qgroups on the filesystem. The result has a two-second
cache, but each quota set invalidates that cache. On a host with many projects,
subvolumes, and snapshots, this makes a single-project operation dependent on
the entire filesystem population.

Btrfs supports targeted alternatives:

- per-qgroup sysfs state for referenced and maximum referenced bytes;
- `btrfs qgroup show -f <path>` as a filtered fallback.

The snapshot implementation already uses the filtered form in related code.

### Runner Repeats Quota Writes

`src/packages/project-runner/run/filesystem.ts` ensures volumes and writes the
home and scratch quota on each start when the configured value is positive.
This duplicates host-side reconciliation and can write an unchanged limit.

### Durable Queue Is FIFO and Loses Context

`src/packages/project-host/file-server/btrfs/quota-queue.ts` serializes quota
mutations in SQLite. Its rows currently contain basic payload, status, retry,
and timestamp fields.

It lacks:

- project ID;
- logical volume;
- desired revision;
- operation ID;
- operation class;
- priority;
- durable mutation attribution;
- per-phase timings;
- coalescing.

Ready rows are selected FIFO. Waiters are in memory. The worker is not
integrated cleanly with the shared Btrfs mutation lock, and AsyncLocal operation
context is not reliably reconstructed after a timer callback or process
restart.

### Quota Mode Is Revalidated Repeatedly

`ensureBtrfsQuotaMode` is called during filesystem initialization and again for
queued quota application. It may inspect filesystem identity and qgroup state
using commands that are unnecessarily broad for every mutation.

### Full Repair Scans All Hosted Projects

`src/packages/project-host/file-server.ts` runs a quota repair at startup and
hourly. It loads all projects, filters them, then reads and potentially writes
home and scratch quotas.

This was added to repair limits lost after quota mode changes or maintenance.
The repair requirement is valid. A synchronous or hourly full-host sweep is
not the right implementation.

### Other Startup-Path O(N) Findings

The systematic audit identified at least two non-quota startup dependencies
that also scale with hosted projects:

1. Managed RootFS startup can call `rootfsUsageByImage()` before normal cache
   usability is known and again after a pull. The usage calculation scans all
   projects.
2. Initial project port lease allocation scans all existing leases. Existing
   leases are O(1), but the first start of a project is O(hosted projects).

These must be fixed before the startup path can be declared population
independent.

### Concurrent Full-Host Work Can Still Distort Starts

Several periodic tasks enumerate broad host state:

- storage admission samples all projects every few seconds;
- host metrics load all projects;
- reconciliation loads all projects and all Podman containers;
- provisioned-volume inventory runs a full Btrfs subvolume list;
- pressure handling loads broad project state;
- ACP rehydration loads all projects on host-agent startup.

Not all of these are directly invoked by a project start. They can still
compete for SQLite, Podman, CPU, and storage while starts run. This plan
requires either incremental/indexed implementations or strict bounded,
low-priority isolation for these loops.

## Target Data Model

### PostgreSQL Desired Revision

Add an additive project column:

```text
run_quota_revision bigint NOT NULL DEFAULT 0
```

The owning bay updates `run_quota` and `run_quota_revision` atomically.

Rules:

- increment only when the normalized persistent desired quota changes;
- do not increment for an identical write;
- allocate the revision in the authoritative database transaction;
- include the revision in project-host registration, start, and quota-update
  requests;
- include the revision in inter-bay routing;
- never synthesize a newer revision at a non-owning bay.

During compatibility rollout, an unversioned message may initialize a legacy
row only if no versioned desired state has been accepted. Once a versioned
revision exists, unversioned messages cannot overwrite it.

### Host Filesystem State

Add a host SQLite table for each managed filesystem:

```text
project_filesystem_quota_state

mountpoint                  primary key
filesystem_uuid            text not null
quota_mode                  text not null
quota_epoch                 integer not null
validated_at                integer not null
last_error                  text
updated_at                  integer not null
```

`quota_epoch` increments when:

- the filesystem UUID changes;
- quota is disabled and re-enabled;
- simple quota mode is migrated or repaired in a way that may discard limits;
- an operator explicitly invalidates all applied-state claims.

Normal validation reads this row and uses a bounded targeted check. It does not
enumerate all qgroups.

### Host Volume Enforcement Ledger

Add:

```text
project_volume_quotas

project_id                  text not null
volume_kind                 text not null
mountpoint                  text not null
relative_path               text not null
desired_bytes               integer not null
desired_revision            integer not null
applied_bytes               integer
applied_revision            integer
applied_quota_epoch         integer
volume_subvolume_id         integer
volume_uuid                 text
volume_generation           integer
state                       text not null
last_error                  text
desired_updated_at          integer not null
apply_started_at            integer
applied_at                  integer
updated_at                  integer not null

primary key (project_id, volume_kind)
```

Initial `volume_kind` values are `home` and `scratch`.

Allowed states:

- `pending`
- `applying`
- `applied`
- `blocked`
- `failed`
- `missing`

An `applied` row is trustworthy only when all of these match:

- desired revision;
- desired bytes;
- quota epoch;
- current volume identity.

The volume identity must change when a volume is recreated, restored, cloned
over, or replaced. The exact identity should use stable Btrfs UUID and
subvolume ID where available. Generation can be retained as an additional
diagnostic, not the sole identity.

### Durable Temporary Overrides

Some existing paths temporarily raise quotas, such as snapshot cleanup or
legacy migration grace. They must not bypass the ledger.

Add:

```text
project_volume_quota_overrides

override_id                 primary key
project_id                  text not null
volume_kind                 text not null
operation_id                text not null
kind                        text not null
minimum_bytes               integer not null
created_at                  integer not null
expires_at                  integer
released_at                 integer
state                       text not null
last_error                  text
```

The effective desired quota is:

```text
max(persistent desired bytes, active override minimum bytes)
```

Override creation and release enqueue normal revision-aware quota work.
Expired or orphaned overrides are reconciled after restart. A temporary
operation cannot leave an unrecorded elevated limit indefinitely.

### Queue V2

Migrate the durable queue to include:

```text
btrfs_quota_queue

id                          primary key
logical_key                 text not null
project_id                  text not null
volume_kind                 text not null
mountpoint                  text not null
desired_revision            integer not null
effective_bytes             integer not null
operation_id                text not null
operation_class             text not null
base_priority               integer not null
attribution_json            text
state                       text not null
available_at                integer not null
first_enqueued_at           integer not null
last_coalesced_at           integer not null
claimed_at                  integer
lock_acquired_at            integer
command_started_at          integer
command_finished_at         integer
completed_at                integer
attempts                    integer not null
last_error                  text
created_at                  integer not null
updated_at                  integer not null
```

`logical_key` is derived from trusted project and volume identity, not from a
caller-supplied path.

There may be at most:

- one queued row for a logical volume;
- one in-progress row for a logical volume;
- one queued follow-up when an in-progress operation is superseded.

Use indexes for state/priority selection, project fairness, operation lookup,
and logical-key coalescing.

## Revision and Transaction Contract

### Accepting Desired State

The host performs these steps in one `BEGIN IMMEDIATE` SQLite transaction:

1. Resolve trusted project and volume metadata.
2. Compare the incoming revision with the stored desired revision.
3. Reject or ignore a stale revision.
4. Treat an identical revision and value as idempotent.
5. Update desired bytes and revision.
6. Mark the row pending when applied state no longer matches.
7. Insert or coalesce the queue row if application is required.
8. Commit before reporting that desired state was accepted.

No Btrfs command runs inside the SQLite transaction.

### Applying Desired State

The worker:

1. Claims the next row transactionally.
2. Reloads the current ledger row.
3. Drops obsolete work if a newer desired revision is already applied.
4. Resolves current trusted volume identity.
5. Reconstructs operation attribution.
6. Acquires the shared Btrfs mutation lock.
7. Rechecks the effective desired state after lock acquisition.
8. Runs an idempotent targeted quota command only when required.
9. Performs a targeted observation when verification is required.
10. Updates applied bytes, revision, epoch, and volume identity transactionally.
11. Resolves waiters whose requested revision is now satisfied.
12. Schedules at most one follow-up if desired state changed in progress.

If the process crashes after step 8, replay is safe. A successful command does
not need exactly-once execution; the ledger needs exactly-once state
convergence.

### Reordered Messages

The host follows:

```text
incoming revision < desired revision: ignore as stale
incoming revision = desired revision and same value: idempotent success
incoming revision = desired revision and different value: contract error
incoming revision > desired revision: accept
```

This rule applies to start payloads, explicit updates, re-registration,
reconciliation, and inter-bay delivery.

## Targeted Quota Observation

### Preferred Path

Resolve a volume's qgroup once from trusted Btrfs identity, then read its
targeted sysfs qgroup entries for:

- referenced bytes;
- exclusive bytes when needed;
- maximum referenced bytes.

Cache only stable identity mapping. Do not cache desired truth in memory.

### Fallback

When the kernel/sysfs representation is unavailable, use:

```text
btrfs qgroup show -prc --raw -f <volume-path>
```

Parse only the qgroup affecting the requested subvolume.

### Forbidden Path

The startup, quota worker, and drift auditor must not use an unfiltered:

```text
btrfs qgroup show ... <mountpoint>
```

Add a development/test guard that fails when an unfiltered qgroup show is
issued from a lifecycle operation. Add command classification metrics in
production builds so regressions remain visible.

### Usage and Decrease Semantics

For quota increases:

1. accept and persist desired state;
2. apply the new limit;
3. perform the usage/headroom check;
4. continue the start.

For quota decreases:

1. observe the target volume only;
2. if referenced usage exceeds the new desired limit, retain desired state as
   blocked and report an actionable error;
3. do not silently clamp or overwrite desired state;
4. retry after usage changes or an explicit desired revision supersedes it.

## Lifecycle-Aware Queue Policy

### Operation Classes

Use these classes:

1. `lifecycle`
2. `interactive`
3. `scheduled`
4. `scavenger`

Examples:

- `lifecycle`: project create, start, restore completion, rehome completion;
- `interactive`: user-requested quota update or operator repair;
- `scheduled`: bounded drift verification and routine preprovisioning;
- `scavenger`: expired override cleanup and low-value audit work.

### Ordering

The scheduler chooses the highest effective priority row. Within a class it
uses per-project round-robin rather than allowing one project to monopolize the
queue.

Effective priority includes bounded age:

```text
effective priority = class priority + age boost
```

Age boost allows scheduled and scavenger work to make progress on a healthy
host. It must not allow background work to leapfrog active lifecycle demand
while storage pressure is `recovery` or `emergency`.

The currently running Btrfs command is not preempted. Therefore lifecycle
latency is bounded by one indivisible lower-priority command plus lock and
command time, not an arbitrary maintenance backlog.

### Coalescing

When a queued row already exists for a logical volume:

- replace desired revision and effective bytes with the newest state;
- retain the highest urgency operation class;
- retain the earliest enqueue time for aging;
- retain all operation IDs needed for waiter/telemetry correlation, or record a
  bounded coalesced count and latest IDs;
- do not create another executable row.

When an older row is in progress:

- update or create one queued follow-up;
- after applying, the worker reloads desired state;
- skip the follow-up if the applied state already satisfies it.

### Durable Context

Persist enough attribution to reconstruct:

- project ID;
- operation ID;
- operation class;
- logical volume;
- owning bay or routing identity when relevant;
- storage cgroup/IO attribution context;
- original enqueue timestamp.

The worker explicitly restores `withBtrfsMutationContext` before acquiring the
shared mutation lock. It must not depend on whatever AsyncLocal context happened
to create a timer.

### Timing

Record and expose separately:

- desired-state acceptance latency;
- queue wait;
- time waiting for the shared mutation lock;
- targeted observation time;
- Btrfs command time;
- verification time;
- SQLite commit time;
- retry/backoff time;
- total lifecycle quota delay.

The project lifecycle metric must never collapse queue wait and command time
into an unexplained total.

## Shared Btrfs Mutation Lock

Quota application must use the existing shared Btrfs mutation lock and priority
model rather than operating beside it.

Before changing the queue, audit all lock call graphs for inversion. In
particular, no caller may:

1. acquire the mutation lock;
2. enqueue a quota operation;
3. synchronously wait for the worker that needs the same lock.

Refactor snapshot cleanup, clone, restore, and legacy migration so the quota
manager owns lock acquisition for its quota step. Multi-step operations use a
documented sequence or a compound operation state machine rather than nested
locking.

Add deadlock tests with deterministic fake locks and time.

## Bounded Startup Flow

The desired project-start sequence is:

1. Resolve the authoritative project and owning bay.
2. Read the project record and desired quota revision.
3. Register or refresh that revision in host SQLite.
4. Resolve the project's existing home and scratch volume identities with
   targeted path operations.
5. Create only missing volumes for this project.
6. Compare desired revision, bytes, quota epoch, and volume identity in SQLite.
7. If all match, perform zero quota mutation and no global quota observation.
8. If application is needed, enqueue lifecycle quota work and wait for the
   required revision.
9. Perform a targeted usage/headroom check when necessary.
10. Prepare the RootFS without computing global project usage on the cache-hit
    path.
11. Resolve or allocate the project's port lease without scanning all leases.
12. Start the project container.

An unchanged start should normally perform:

- keyed PostgreSQL/SQLite reads;
- targeted filesystem existence/identity checks;
- zero `qgroup limit` writes;
- zero unfiltered qgroup reads;
- zero full project, container, subvolume, or lease scans.

## Home and Scratch Preprovisioning

### Home

Today host registration can explicitly use `ensure_volume: false`, which moves
home creation into first start. Change the workflow so a successfully fenced
placement schedules low-priority home creation and quota application before the
first start.

Requirements:

- placement/rehome generation is part of the task;
- obsolete work cannot create a volume on a previous host after reassignment;
- interactive first start can promote or coalesce the same task to lifecycle;
- first-start fallback remains targeted and correct.

### Scratch

Scratch is intentionally reset on a cold lifecycle. Move common-path reset from
start to post-stop finalization:

1. after the project is fully stopped, delete the old scratch volume;
2. create its replacement asynchronously;
3. record the new volume identity;
4. apply the desired scratch quota;
5. mark it ready for the next start.

For first placement, precreate scratch with home.

If a host or process crashes before post-stop preparation completes, the next
start performs the same targeted operation at lifecycle priority. It does not
run a host-wide repair.

## Removing Unconditional Runner Writes

The runner must not independently set home and scratch quotas on every start.

Migration sequence:

1. Keep runner fields for compatibility and diagnostics.
2. Add a host-provided assertion that the required quota revision is applied.
3. In observe mode, compare runner values with the ledger and report mismatch.
4. Once staging proves conformance, remove normal runner quota writes.
5. Retain an explicit emergency compatibility path behind a host-local/site
   feature flag.
6. The emergency path must still enter the durable quota manager, not call raw
   Btrfs quota mutation directly.

## Replacing the Full Repair Sweep

### Pending-State Worker

The primary repair mechanism is the enforcement ledger:

- desired but unapplied rows are already pending;
- process restart recovers in-progress rows;
- quota-epoch change makes affected rows logically pending;
- volume-identity change makes that volume pending;
- registration and lifecycle access refresh a project's desired revision.

There is no need to discover normal work by scanning every project.

### Bounded Drift Auditor

Retain defense in depth with a cursor-based auditor:

- examine a fixed number of volumes per interval, initially 16 or 32;
- persist the cursor;
- use only targeted reads;
- run as `scheduled` or `scavenger`;
- pause or reduce work under storage pressure;
- enqueue repair through the normal ledger;
- expose scanned, drifted, repaired, and error counts;
- complete a full audit eventually without making host startup depend on it.

`stale_project_count` must mean actual stale state, not merely rows omitted from
the current sampling window.

### Quota Epoch Invalidations

Do not update every project row synchronously when the epoch changes. A row with
an old applied epoch is already logically pending.

Use:

- lifecycle access for immediate repair of active projects;
- an indexed/paginated database query for background convergence;
- bounded queue insertion;
- no full-host transaction or queue burst.

## Eliminating Other Startup O(N) Operations

### RootFS Usage

Refactor managed RootFS preparation so a normal usable cache entry does not
call `rootfsUsageByImage()`.

Use one or both of:

- a maintained indexed usage table/counter updated when project RootFS
  assignment changes;
- a targeted indexed SQL query for only the relevant image when eviction or
  stale-entry validation actually needs usage.

Requirements:

- cache-hit project start does not scan all projects;
- post-pull bookkeeping does not scan all projects;
- eviction may do bounded/indexed global planning outside the lifecycle
  critical path;
- usage counters can be rebuilt by a background bounded audit.

### Port Lease Allocation

Replace first-time full lease enumeration with bounded allocation:

1. derive a deterministic candidate from project ID and configured port range;
2. attempt an indexed `INSERT` protected by a uniqueness constraint;
3. use deterministic bounded probing on collision;
4. optionally maintain a free-list for large ranges;
5. fail clearly after a configured bounded probe count.

Existing lease lookup remains keyed by project ID.

### Static Guard

Create a startup-path dependency test or lint-like architectural test that
rejects calls from lifecycle modules to known global operations, including:

- `listProjects()` without a project/indexed predicate;
- unfiltered `podman ps -a` enumeration;
- unfiltered `btrfs qgroup show`;
- `btrfs subvolume list`;
- full port lease listing;
- RootFS usage across all projects.

Runtime command attribution provides a second line of defense.

## Isolating Concurrent Host-Wide Work

The direct startup path is the first acceptance gate. Full-host periodic work
must also be prevented from creating the same latency indirectly.

For each periodic loop, record:

- current complexity;
- cadence;
- resources and locks used;
- whether it runs during host startup;
- whether it can overlap lifecycle operations;
- replacement strategy.

Required changes:

| Loop                   | Required strategy                                                                                                    |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| storage admission      | maintain incremental active/starting counters or use indexed state queries; do not load all projects every sample    |
| host metrics           | use incremental counters and bounded sampling; separate expensive inventory cadence                                  |
| project reconciliation | query only active/transitional projects and reconcile known managed containers; move full inventory to bounded audit |
| provisioned volumes    | maintain SQLite inventory as volumes change; perform cursor-based filesystem verification                            |
| quota repair           | replace with ledger plus bounded drift auditor                                                                       |
| pressure handling      | select candidates using indexed state and bounded pages                                                              |
| ACP rehydration        | load only projects requiring rehydration, paginated and lifecycle-aware                                              |

If a complete incremental replacement is not ready in the first patch, the loop
must at minimum:

- never run as a host-readiness prerequisite;
- use bounded pages;
- yield between pages;
- run through low-priority storage admission;
- suspend while lifecycle storage operations wait;
- expose elapsed and work counts.

No unbounded loop may remain hidden behind a timer.

## API and Multibay Contract

Before implementation, verify every quota mutation path against
`src/.agents/scalable-architecture.md`.

Rules:

- the owning bay allocates desired revisions;
- non-owning bays route, but do not author, persistent desired quota;
- project-host registration includes owning bay, placement generation, desired
  quota, and desired revision;
- inter-bay start and update calls preserve the revision;
- host SQLite keys remain project IDs plus volume kind, with placement/rehome
  fencing;
- a host rejects stale placement generations before creating or mutating
  volumes;
- rehome copies authoritative desired state, not observed old-host Btrfs state.

## Implementation Phases

### Phase 0: Instrumentation and Architectural Guards

Deliverables:

- assign one operation ID to every project start;
- propagate lifecycle mutation context through volume and quota preparation;
- classify every Btrfs command as targeted or global;
- emit phase timing for current quota check, queue wait, RootFS preparation,
  port allocation, and Podman start;
- add a test guard for unfiltered qgroup reads in lifecycle context;
- inventory all direct `.quota.set` call sites;
- inventory all startup-reachable `listProjects`, container list, subvolume
  list, qgroup list, and lease list calls.

Exit criteria:

- a staging project start has a complete phase trace;
- the trace identifies every Btrfs command and whether it is global;
- current behavior can be baselined before optimization.

### Phase 1: Targeted Observation and Quota-Mode Cache

Deliverables:

- targeted sysfs qgroup reader;
- filtered `qgroup show -f` fallback;
- trusted volume-to-qgroup identity resolution;
- filesystem UUID, mode, validation time, and quota epoch table;
- bounded quota-mode validation;
- tests for missing sysfs, recreated volumes, mode changes, and parser errors;
- removal of unfiltered qgroup show from start and worker paths.

Exit criteria:

- one project's quota read has constant command/output size as qgroup population
  grows;
- startup performs no unfiltered qgroup show;
- quota-mode validation does not enumerate all qgroups per mutation.

### Phase 2: Desired/Applied Ledger and Revisions

Deliverables:

- additive PostgreSQL quota revision migration;
- atomic desired quota update;
- revision propagation through local and inter-bay APIs;
- host SQLite ledger migration;
- desired-state acceptance transaction;
- stale/reordered message handling;
- volume identity and quota epoch matching;
- dual-write/observe mode for compatibility;
- operator diagnostics for desired versus applied state.

Exit criteria:

- stale RPCs cannot overwrite newer state;
- unchanged desired state is detectable without reading Btrfs;
- a process restart preserves pending work;
- old host and new host versions coexist safely during staging rollout.

### Phase 3: Queue V2 and Override State Machine

Deliverables:

- additive queue migration;
- operation class and priority;
- per-project fairness;
- starvation aging;
- logical-volume coalescing;
- one-follow-up semantics for in-progress supersession;
- shared Btrfs mutation lock integration;
- durable context reconstruction;
- per-phase timing;
- crash recovery;
- temporary override ledger;
- refactored snapshot cleanup, restore, clone, and migration quota paths;
- private raw Btrfs quota setter accessible only by the quota manager.

Exit criteria:

- lifecycle work bypasses a large queued maintenance backlog after at most one
  in-progress command;
- repeated desired updates cause at most one pending command per logical
  volume;
- crash injection at every state boundary converges;
- no lock inversion or nested queue wait remains.

### Phase 4: Bounded Lifecycle Path and Preprovisioning

Deliverables:

- startup ledger fast path;
- apply-and-await only for mismatched revisions, identity, or epoch;
- preserved targeted usage/headroom check;
- removal of normal runner quota writes;
- asynchronous home preparation after placement;
- asynchronous scratch preparation after stop;
- lifecycle promotion of unfinished preprovision work;
- placement-generation fencing.

Exit criteria:

- an unchanged start writes no quota;
- restored project with an increased desired quota starts correctly;
- quota decrease below usage remains safely blocked;
- host restart with unapplied state repairs only the requested project before
  its start;
- no project container restart is needed to activate the feature.

### Phase 5: Remove Remaining O(N) Dependencies

Deliverables:

- RootFS cache-hit path without all-project usage scan;
- indexed or maintained RootFS usage;
- bounded deterministic port lease allocation;
- ledger-based quota repair and bounded drift audit;
- bounded/incremental conversion of recurring broad loops;
- architectural tests for forbidden global operations.

Exit criteria:

- a project start trace contains no operation proportional to hosted projects,
  total containers, total subvolumes, total qgroups, or unrelated snapshots;
- host readiness contains no full repair sweep;
- periodic work yields to lifecycle work and is bounded per tick.

### Phase 6: 10K Staging Qualification

Deliverables:

- dedicated disposable staging scalability host;
- repeatable population and cleanup tools;
- before/after baseline reports;
- 10,000+ project and volume population;
- functional, scalability, concurrency, restart, and fault-injection tests;
- operator dashboard or report for all acceptance metrics.

Exit criteria:

- all staging acceptance criteria in this document pass;
- no unexplained global command appears in traces;
- no correctness drift remains after fault injection;
- the complete test is reproducible from documented commands.

### Phase 7: Production Release Preparation

This phase creates the release artifact and runbook only. It does not deploy.

Deliverables:

- one compatibility-first promoted artifact set;
- additive database migration;
- all feature switches present before production;
- canary, ramp, rollback, and observability runbook;
- explicit list of processes affected by reload;
- confirmation that `ctl restart` is not required;
- staging evidence attached to the review.

Exit criteria:

- explicit user approval for production is still required;
- no production mutation has occurred.

## Staging Scalability Environment

### Dedicated Host

Use a disposable staging project host and storage volume. Do not put 10,000
synthetic projects on either normal shared staging host.

The host should:

- use the same filesystem and quota mode as production;
- use a representative machine and disk class;
- expose the same project-host, runner, and host-agent services;
- be safe to delete and recreate;
- have enough disk metadata capacity for at least 20,000 managed volumes plus
  snapshots;
- have no route to production control-plane credentials.

### Population Shape

Create at least:

- 10,000 real staging project records owned by the staging bay;
- 10,000 home subvolumes;
- 10,000 scratch subvolumes or equivalent lifecycle-ready scratch identities;
- quotas applied through the new ledger;
- snapshots on a representative subset sufficient to push total qgroup count
  materially above 20,000;
- a representative distribution of RootFS images and port leases.

Most projects remain stopped. The purpose is to reproduce the intended
10,000+-hosted-project state, not to run 10,000 containers.

Use clearly tagged synthetic accounts/projects. Suppress:

- user email;
- billing;
- purchase records;
- normal notifications;
- external backups unless explicitly part of a test.

The population tool must be resumable, bounded-concurrency, idempotent, and able
to clean up only its own tagged resources.

### Test Cohorts

Maintain at least:

- a 100-project baseline;
- a 1,000-project intermediate population;
- a 10,000-project required population;
- an optional 20,000-project stretch population if metadata and time permit.

Run the same tests at each population without changing the artifact or host
shape.

## Staging Test Matrix

### Normal Starts

Measure:

- stopped project with preprovisioned home and scratch;
- stopped project missing scratch;
- first-ever start;
- warm RootFS cache hit;
- cold RootFS pull;
- project with unchanged quota;
- project immediately after quota increase;
- project with requested decrease above current usage;
- project with requested decrease below current usage.

Run serial and bounded concurrent starts. Include bursts of at least 10, 25, 50,
and, if host capacity permits, 100 starts.

### Correctness Regressions

Test:

- restored project whose usage exceeds an old live limit but is below a newer
  desired limit;
- stale start payload after a newer quota update;
- duplicate desired update;
- same revision with conflicting value;
- volume recreated with the same desired revision;
- quota epoch increment;
- rehome while preprovision is queued;
- clone and restore volume replacement;
- scratch reset after clean and unclean stop;
- expired temporary override;
- snapshot cleanup requiring temporary headroom.

### Queue Behavior

Test:

- thousands of scheduled audit rows followed by a lifecycle request;
- many updates to one volume before execution;
- updates while that volume is in progress;
- several noisy projects plus unrelated lifecycle requests;
- sustained lifecycle load followed by maintenance aging;
- recovery and emergency storage pressure;
- lock contention with snapshot/restore work.

### Fault Injection

Terminate the project-host process:

- after desired state is persisted;
- after queue insertion;
- after row claim;
- after lock acquisition;
- after Btrfs command success but before applied-state commit;
- after override creation;
- after override release is requested;
- during preprovision;
- during quota epoch transition.

Also test:

- host reboot;
- SQLite busy/temporary failure;
- Btrfs command timeout;
- transient missing volume;
- filesystem UUID mismatch;
- process restart with legacy queue rows;
- rollback to the compatibility feature switch.

### Scale and Interference

At each population:

- start the same fixed canary projects;
- run a bounded drift audit;
- run metrics and reconciliation loops;
- create and remove snapshots on unrelated projects;
- perform RootFS inventory/eviction planning;
- allocate first-time port leases;
- restart only the project-host service and measure readiness;
- reboot the host and measure readiness plus convergence.

The test harness records command counts and output sizes, not just elapsed time.

## Acceptance Criteria

### Complexity

At 10,000 projects:

- zero unfiltered qgroup show commands occur in a start;
- zero full subvolume list commands occur in a start;
- zero all-project SQL/SQLite loads occur in a start;
- zero all-container Podman lists occur in a start;
- zero all-lease scans occur in a start;
- zero all-project RootFS usage scans occur in a cache-hit start;
- unchanged start performs zero quota limit writes;
- host readiness does not run or wait for a full quota sweep.

### Scalability

For the host-side volume/quota preparation phase:

- 10,000-project p50 and p95 must be within 10% or 250 ms, whichever is larger,
  of the 100-project baseline;
- no phase may show a statistically significant positive slope caused by
  hosted-project population;
- targeted quota observation output remains bounded;
- memory used by one start does not grow with hosted-project population.

Overall project start has additional RootFS and Podman variance. Report p50,
p95, and p99, but evaluate the population-independence of each phase separately
rather than hiding it in the total.

### Queue Responsiveness

With a maintenance backlog:

- lifecycle quota work starts after at most the currently running indivisible
  Btrfs mutation plus 250 ms scheduler overhead;
- no project can hold more than its fair consecutive share when other projects
  are waiting at the same class;
- coalesced updates execute only the latest required state;
- maintenance eventually progresses during a healthy sustained test.

### Correctness

- desired and applied revisions converge for every test volume;
- stale messages never regress desired state;
- restored-project quota increase regression remains fixed;
- decrease-below-usage remains blocked without corruption;
- epoch and volume replacement cause reapplication;
- every fault-injection point converges after restart;
- no temporary override remains active or elevated after its operation and
  recovery complete;
- the bounded auditor detects intentionally injected drift.

### Operational Safety

- project-host process reload does not restart project containers, ACP workers,
  or unrelated user services;
- queue and ledger migrations are additive and restart-safe;
- feature rollback does not discard desired or applied records;
- test population cleanup leaves no untagged project, volume, qgroup, lease, or
  database row changed;
- no production API, host, database, DNS, or storage resource is touched.

## Feature Switches

Ship the complete staging artifact with switches that can be changed without
another software deployment:

- `project_host_quota_ledger_mode=off|observe|enforce`
- `project_host_quota_queue_v2=off|observe|enforce`
- `project_host_quota_targeted_reads=off|enforce`
- `project_host_quota_runner_writes=legacy|observe|off`
- `project_host_quota_drift_auditor=off|observe|enforce`
- `project_host_quota_legacy_sweep=on|off`
- `project_host_volume_preprovision=off|observe|enforce`
- `project_host_startup_global_operation_guard=observe|enforce`

Switch combinations must be validated. In particular, never turn off legacy
runner writes before ledger enforcement is active and proven.

Production later receives one artifact containing all switches. Activation can
then proceed by configuration without repeatedly replacing software.

## Observability

### Metrics

Add counters and histograms for:

- desired quota updates by accepted, duplicate, stale, and conflict;
- ledger rows by state;
- queue depth by class;
- queue age by class;
- coalesced updates;
- queue wait;
- lock wait;
- command time;
- verification time;
- retry count and reason;
- targeted versus global Btrfs commands;
- quota epoch;
- drift sampled, detected, repaired, and failed;
- startup quota fast-path hit;
- startup quota mutation;
- home/scratch preprovision state;
- startup forbidden-global-operation detection;
- phase timings for RootFS and port lease work.

### Diagnostics

Host health and admin diagnostics should show:

- desired quota and revision;
- effective quota including override;
- applied quota and revision;
- quota epoch and applied epoch;
- volume identity;
- pending queue row and age;
- last command and error;
- whether the latest start used the fast path;
- most recent startup phase timings.

Avoid reporting unsampled projects as stale. Report sampling coverage and actual
staleness separately.

### Alerts

Alert on:

- lifecycle queue age above a short threshold;
- growing pending/failed ledger rows;
- desired/applied mismatch for running projects;
- repeated quota command failure;
- an unfiltered Btrfs operation in lifecycle context;
- quota epoch churn;
- drift repair failure;
- project-host readiness blocked by broad inventory work.

Do not page solely for a bounded maintenance backlog when lifecycle work is
healthy and the backlog is aging normally.

## Code Areas

Expected primary areas include:

- `src/packages/server/projects/control/base.ts`
- project database schema and migrations under `src/packages/database`
- project-host and inter-bay API types
- `src/packages/project-host/sqlite/projects.ts`
- new host SQLite quota-ledger module
- `src/packages/project-host/hub/projects.ts`
- `src/packages/project-host/file-server.ts`
- `src/packages/project-host/file-server/btrfs/quota-queue.ts`
- `src/packages/project-host/file-server/btrfs/operation-cache.ts`
- Btrfs subvolume and snapshot modules
- `src/packages/project-host/storage-operation-registry.ts`
- `src/packages/project-host/storage-admission.ts`
- `src/packages/project-host/rootfs-cache.ts`
- `src/packages/project-host/sqlite/port-leases.ts`
- `src/packages/project-runner/run/filesystem.ts`
- project-host metrics and health diagnostics
- staging project-host deployment and stress-test tooling

Before editing, use symbol search to find every:

- `.quota.set`;
- `qgroup show`;
- `qgroup limit`;
- `listProjects`;
- `podman ps`;
- `subvolume list`;
- RootFS usage aggregation;
- port lease list;
- filesystem creation and replacement path.

The audit result should be checked into the implementation PR or recorded in a
companion document so new call sites are not missed.

## Test Strategy

### Unit Tests

Cover:

- revision comparison and conflict rules;
- SQLite migrations from legacy rows;
- desired acceptance transaction;
- queue selection, fairness, aging, and coalescing;
- follow-up behavior;
- crash recovery;
- volume identity matching;
- quota epoch invalidation;
- effective quota with overrides;
- targeted parser/sysfs behavior;
- bounded port probing;
- RootFS cache-hit behavior.

Use fake time and deterministic schedulers for queue tests. Do not fix timing
tests by merely increasing Jest timeouts.

### Integration Tests

Use a real disposable Btrfs loopback filesystem where CI permits:

- create many subvolumes/qgroups;
- prove targeted read output and latency do not scale with unrelated qgroups;
- apply, observe, recreate, and reapply;
- disable/re-enable quota and verify epoch behavior;
- kill the worker at controlled boundaries;
- verify no unfiltered command through command tracing.

Where privileged Btrfs is unavailable, run the same state-machine tests with a
strict command adapter fake and reserve real-filesystem tests for staging CI.

### End-to-End Tests

Use real staging hub, project host, runner, PostgreSQL, SQLite, Podman, and
Btrfs:

- quota update while stopped then start;
- quota update while running;
- restore and start;
- stop, scratch preparation, and restart;
- rehome/reconcile;
- project-host process restart;
- host reboot;
- 10K population tests.

## Production Rollout Design for Later

No step in this section is authorized until staging qualification is reviewed.

When authorized, minimize disruption with:

1. additive PostgreSQL migration and compatibility API;
2. one promoted project-host/runner artifact containing all feature switches;
3. non-disruptive project-host service reload that does not invoke broad
   `ctl restart`;
4. observe mode;
5. private-host canary;
6. one small shared-host canary;
7. staged fleet activation;
8. legacy sweep and runner writes disabled only after conformance.

Suggested canary order remains:

- private `wstein`;
- a low-risk shared host;
- a small regional cohort;
- the rest of the fleet.

Each stage requires:

- lifecycle latency comparison;
- queue health;
- desired/applied conformance;
- no project-container or ACP restart;
- rollback rehearsal;
- explicit operator continuation.

Rollback is configuration-first:

- stop new queue-v2 activation;
- restore compatibility behavior through the manager;
- retain the additive ledger and revisions;
- do not destructively downgrade schema;
- do not allow legacy behavior to overwrite newer versioned desired state.

## Deliverables

The implementation is complete only when the repository contains:

- database migrations;
- versioned API contract;
- host quota ledger;
- queue v2;
- targeted quota observer;
- quota epoch and volume identity handling;
- durable overrides;
- bounded startup path;
- preprovisioning;
- bounded drift auditor;
- RootFS and port lease O(N) fixes;
- recurring-loop audit and bounded replacements;
- command guards and telemetry;
- unit and integration tests;
- 10K staging population and cleanup tools;
- staging result report;
- later production runbook.

## Definition of Done

This phase is done when:

1. Every persistent quota mutation originates from authoritative versioned
   desired state.
2. Every temporary mutation is represented by a durable override.
3. The host can prove whether desired quota is applied without a global Btrfs
   read.
4. An unchanged start performs no quota write.
5. No project-start phase is O(number of hosted projects or global filesystem
   objects).
6. Maintenance cannot strand lifecycle work behind a FIFO backlog.
7. Crash and message-reordering tests converge.
8. The 10K staging test passes all complexity, scalability, correctness, and
   operational criteria.
9. The implementation and staging evidence have been reviewed.
10. Production remains unchanged until separately approved.

## Recommended Execution

Proceed with phases 0 through 6 as one coherent staging program. Keep commits
reviewable by phase, but avoid partial production deployment. The most
important design choice is to establish durable desired/applied truth before
removing defensive live checks. Once that truth exists, skipping unchanged
quota work is a correctness-preserving optimization rather than a gamble.

The 10K staging host is not optional. Small hosts can hide whole-filesystem
commands behind cache and fast metadata. The final evidence must demonstrate
that per-project lifecycle latency is independent of the number of stopped
projects assigned to the host.
