# Project-Attributed Storage Operations Design

Status: detailed design and implementation plan for review

Date: 2026-07-22

Production status: unchanged by this document. Phase 0 telemetry and Phase 1
static I/O containment have been validated on staging. This document specifies
the separate Phase 2 implementation and does not authorize a production
deployment.

## Executive Decision

CoCalc should continue avoiding a full project runtime unless user code must
execute. Starting a project just to delete, copy, scan, snapshot, back up, or
restore its files would waste resources, increase latency, and couple storage
administration to runtime health.

The missing abstraction is a project-attributed storage worker:

- the shared project-host process authorizes, validates, schedules, and reports
  an operation;
- a short-lived worker performs work whose cost scales with project-controlled
  bytes or directory entries;
- the worker enters the project's resource-control boundary before opening
  project data;
- long-running or destructive operations are journaled durably and recover
  after a project-host restart or host reboot;
- narrowly scoped privileged helpers perform only the Btrfs and
  descriptor-anchored filesystem transitions that require privilege;
- ordinary project runtimes remain stopped unless code execution is requested.

The central invariant is:

> Work whose cost can scale with project-controlled bytes or entry count must
> not execute in the shared project-host control process unless a hard protocol
> bound makes its worst-case cost small.

This is the architectural successor to
[`project-host-io-containment-plan-2026-07-20.md`](./project-host-io-containment-plan-2026-07-20.md).
The existing `io.max` hierarchy remains the host-survival boundary. Workers
solve the separate attribution, memory, event-loop, cancellation, and recovery
problems that static block-I/O limits cannot solve.

## Relationship To Phase 1

Phase 1 and Phase 2 must remain independently reviewable and deployable.

- Phase 1 places aggregate and per-project `io.max` ceilings on project
  workloads and fails closed for new placement when explicit enforcement is
  not valid.
- Phase 2 moves project-data-dependent host work into the project boundary and
  makes hazardous operations restart-safe.
- The Phase 1 production canary may proceed after its own soak and review. It
  must not wait for this design.
- Phase 2 is disabled by default in every artifact until each operation kind
  passes its own staging and canary gates.
- A Phase 2 rollback must not remove or weaken Phase 1 limits.

Staging evidence for Phase 1 is recorded in
[`project-host-io-containment-final-staging-results-2026-07-22.md`](./project-host-io-containment-final-staging-results-2026-07-22.md).

## Goals

1. Keep project-host health, Conat routing, file-server authorization, and
   unrelated projects responsive during expensive project storage operations.
2. Attribute CPU, memory, PIDs, and block I/O for project-data-dependent work to
   the responsible project.
3. Support operations on stopped projects without starting their full runtime.
4. Make destructive and multi-step storage operations restart-safe and
   observable.
5. Preserve descriptor-anchored path validation and the existing multibay
   authority model.
6. Bound concurrency by project, host, operation class, disk admission state,
   and observed pressure.
7. Reuse the existing long-running-operation (LRO) user experience while
   keeping local recovery independent of Conat availability.
8. Make rollout operation-specific, reversible, and impossible to enable by an
   unrelated release accidentally.
9. Cover user-triggered file operations, project-host backup and restore paths,
   snapshot maintenance, and unattributed host maintenance.

## Non-Goals

- Starting a container or full project runtime for storage administration.
- Replacing Btrfs, Rustic, R2, or the current backup model.
- Guaranteeing exactly-once side effects across SQLite and the filesystem.
- Treating `io.weight`, `ionice`, or a cloud-disk benchmark as a correctness
  boundary.
- Putting arbitrary commands behind a generic privileged worker interface.
- Proxying steady-state project data through a hub or bay.
- Enabling automatic project stopping in the initial rollout.
- Shipping atomic trash in the first worker release before its snapshot and
  backup semantics are proven.

## Architectural Constraints

The design follows
[`scalable-architecture.md`](./scalable-architecture.md):

- the owning bay is authoritative for project authorization, placement, moves,
  and user-visible operation records;
- the project host is authoritative for local execution state and local
  filesystem truth;
- the hub or bay routes and observes an operation but does not carry the file
  data;
- the same contracts must work in one-bay Launchpad and multibay Rocket;
- a request must bind to an explicit project and host assignment rather than
  assuming the local database is authoritative;
- cross-bay and cross-host operations use the routing layer and explicit
  ownership, never a local-database shortcut.

Path security remains governed by [`sandbox.md`](./sandbox.md). Moving an
operation to a child process must not replace openat2 or descriptor-anchored
resolution with string-prefix checks, `realpath` followed by mutation, or a
shell command.

## Current-State Inventory

### Existing containment

Project runtimes currently run in:

```text
/sys/fs/cgroup/cocalc-project-pool/project-<project-id>
```

The privileged `cocalc-runtime-storage` helper can prepare, enter, attach, and
verify project cgroups. Recursive live-file deletion now infers the project ID
strictly from `/mnt/cocalc/project-<uuid>(-scratch)?`, enters the project leaf,
verifies membership, and then executes the native path helper. This is the
correct pattern to generalize.

### Existing operation paths

The following table is an implementation inventory, not a claim that every
listed path is currently unsafe in practice. The risk column asks whether cost
can be selected by project contents.

| Operation | Current execution | Data-dependent risk | Target class |
| --- | --- | --- | --- |
| Recursive `rm` and `rmdir` on live files | Native child via privileged helper, already attached to project leaf | Entries, metadata, writeback | Durable mutation for large/recursive requests; transient worker for proven-small requests |
| Non-recursive metadata calls | Shared sandbox process | Constant or tightly bounded | Bounded inline |
| `copyFile` | Shared Node process; safe path can buffer the entire source | Bytes and process memory | Transient or durable project worker with streaming and byte limits |
| Recursive `cp` | Shared Node recursion or spawned `cp` | Entries, bytes, memory, metadata | Durable project worker |
| `move` with cross-device fallback | Shared process and recursive copy fallback | Entries and bytes | Durable mutation |
| `find`, `fd`, `ripgrep`, `du`, `dust` | Spawned with timeouts, but under the shared project-host cgroup | Entries, bytes, page cache, output | Supervised project read worker |
| `ouch` archive creation/extraction | Spawned for up to ten minutes under shared cgroup | Entries, bytes, CPU, temporary space | Durable mutation for extraction; supervised/durable read worker for creation |
| Directory listing | Shared process; all names retained, then unbounded `Promise.allSettled` lstat fan-out | Directory cardinality and memory | Bounded paginated inline path, with worker fallback only if needed |
| Ordinary file read/write streams | Shared file-server process | Bytes, concurrency, page cache | Hard per-request and per-project bounds first; project transfer worker for requests above threshold |
| Snapshot path prune | Shared coordinator; recursive delete child is attributed, but quota relief/read-only transitions are synchronous and not durable | Entries, Btrfs metadata, interrupted state | Durable snapshot-prune state machine plus project worker |
| Snapshot create/delete/update | Shared project-host process | Btrfs metadata and count | Bounded privileged transition or durable operation when cleanup scales |
| Snapshot restore | Shared project-host multi-step workflow | Bytes, subvolumes, cleanup, crash state | Durable mutation |
| Project backup | Rustic child via privileged wrapper, currently not attached to project cgroup | Entries, bytes, network, memory | Durable project read worker |
| Project restore | Rustic child via privileged wrapper, currently not attached to project cgroup | Entries, bytes, network, metadata | Durable project mutation |
| Pending cross-host copies | Shared project-host orchestration and long Rustic work | Bytes, retries, staging cleanup | Durable source and destination operations tied to the move LRO |
| Path-copy archive | Shared process walks files, snapshots, copies, and accumulates a tar-gzip buffer | Entries, bytes, memory | Bounded worker pipeline; no unbounded archive buffer in coordinator |
| Legacy archive restore/remediation | Shared multi-step project-host workflow | Bytes, entries, quota transitions | Durable project mutation |
| Backup index building/search | Mixed shared-process and Rustic work | Backup count, entries, object-store I/O | Project worker when project-specific; maintenance worker for shared indexes |
| Rootfs publish/restore/cache | Mixed project-specific and host-cache work | Bytes, entries, network, disk | Split project-attributed phases from host-maintenance phases |
| Volume deletion and restore-staging cleanup | Shared multi-step project-host workflow | Snapshots, entries, subvolumes | Durable mutation |
| BEES | Dedicated bounded cgroup | Host-wide maintenance | Keep independent; no design change |
| OCI/rootfs cache pruning, upgrade cleanup, global GC | Shared host maintenance paths | Host bytes and metadata | Dedicated bounded maintenance worker pool |

### Specific current hazards

1. `getListing` collects every directory entry and starts one lstat promise per
   entry. A directory with millions of names can cause host memory and event
   loop pressure without starting a project.
2. safe-mode recursive copy walks the tree in the project-host Node process.
3. `copyFile` can materialize a project-selected file in a Node buffer.
4. search and archive subprocesses inherit the shared host cgroup even when
   their wall-clock timeout is bounded.
5. `project-rustic-backup` and `project-rustic-restore` are narrow privileged
   commands, but they do not currently enter the project leaf.
6. snapshot pruning holds temporary quota relief and can leave snapshots
   writable if the process is killed between transitions.
7. the existing global Btrfs mutation lock can be held around recursive work,
   making one project block unrelated operations for a long time.
8. user-visible LRO events are useful but are not a durable host-local recovery
   record.

## Operation Classification

Every filesystem API is assigned one of four execution classes. Review must
reject a new API that has no class.

### Class A: bounded inline metadata

The shared project-host process may perform an operation only when all relevant
cost dimensions have hard, low bounds before execution. Examples include
`lstat`, reading a bounded text preview, a single rename on one filesystem, and
a paginated listing with bounded lstat concurrency.

Requirements:

- explicit byte, entry, output, and wall-clock bounds as applicable;
- no recursion;
- no whole-file buffering above the bound;
- bounded concurrency independent of directory size;
- abort on client cancellation where the underlying API supports it.

### Class B: supervised transient project worker

Read-only or idempotent work with a short timeout can run in an ephemeral child
without a durable operation record. Examples are ripgrep, find, du, dust, and a
bounded archive inspection.

Requirements:

- attach and verify the project cgroup before opening project data;
- fixed executable and argument schema, never a shell;
- hard timeout, output cap, memory limit, PID limit, and host concurrency slot;
- cancellation kills the process group;
- descendants inherit the project cgroup;
- failure or project-host restart may safely discard the operation.

### Class C: durable project storage operation

Destructive, long-running, multi-step, or externally visible work uses a
durable journal. Examples are recursive delete, snapshot pruning, recursive
copy/move, archive extraction, backup, restore, and project-move staging.

Requirements:

- stable `op_id` supplied by the authoritative control plane;
- immutable validated operation specification;
- durable state and transition journal;
- project mutation lease and placement fencing;
- idempotent recovery based on observed filesystem state;
- LRO progress projection;
- no automatic fallback to the legacy path after acceptance.

### Class D: bounded host-maintenance worker

Work not attributable to one project must not be charged arbitrarily to a user.
Examples include global OCI cache pruning, rootfs cache GC, upgrade cleanup, and
shared backup-index maintenance.

Class D runs in a dedicated `cocalc-storage-maintenance` cgroup with aggregate
CPU, memory, PID, and I/O ceilings. It is lower priority than project service,
is pressure-aware, and cannot run in the project-host control process.

## Target Architecture

```text
browser / CLI
      |
      | authorize, choose owning bay, create/reuse op_id
      v
owning bay / hub  ---------------------> Conat LRO projection
      |
      | project-host RPC bound to project and placement generation
      v
project-host coordinator
      |-- validate immutable spec and path contract
      |-- journal intent and acquire durable leases
      |-- perform only bounded metadata/Btrfs transitions
      |-- publish progress and terminal state
      |
      +--> project storage worker
      |      |-- attach+verify project cgroup before data access
      |      |-- stream progress/result through bounded protocol
      |      `-- perform data-dependent traversal/copy/backup/restore
      |
      `--> narrow privileged helper
             |-- strict operation-specific arguments
             |-- openat2/descriptor-anchored path operations
             `-- short Btrfs/quota/read-only transitions
```

The coordinator can live in the project-host service initially because its
work is deliberately bounded. A later split into a separate supervisor process
is possible without changing the journal or RPC contracts.

## Project Cgroup Model

### Initial implementation

The first implementation attaches storage workers to the existing leaf:

```text
cocalc-project-pool/project-<project-id>
```

This is deliberate:

- it gives correct aggregate and per-project attribution immediately;
- a stopped project can have its leaf created from its persisted service class
  without starting a container;
- runtime and storage work together remain below the project's ceiling;
- the current privileged helper already implements strict project inference,
  cgroup creation, attachment, and verification.

The launcher must move itself into the leaf and verify `/proc/self/cgroup`
before it resolves or opens the project root. Child processes inherit the leaf.
In enforcement mode, failure to attach or verify fails closed.

PID placement is necessary but is not by itself proof that Btrfs metadata and
asynchronous writeback are fully attributed by the deployed kernel. Every
operation canary must compare project-leaf and pool `io.stat` deltas with device
traffic and host pressure. If material work escapes the leaf, retain the
per-project worker for CPU/memory/event-loop isolation and add a bounded host
Btrfs transition queue or a stricter aggregate safety envelope. Do not report
full I/O attribution based only on successful cgroup attachment.

The coordinator may remove an otherwise empty dynamically created leaf only
after the operation is terminal and no project runtime uses it. Cgroup cleanup
is an optimization, not an operation-completion requirement.

### Future runtime/storage children

A future hierarchy may separate interactive runtime and background storage
work:

```text
project-<project-id>/
  runtime/
  storage-interactive/
  storage-background/
```

This is not a harmless directory addition. In cgroup v2, a non-threaded cgroup
with child cgroups cannot also retain normal processes. Introducing children
requires moving every runtime process out of the current project leaf and
changing project start, reconciliation, helper verification, telemetry, and
cleanup atomically.

Therefore:

1. Phase 2 starts with the existing leaf.
2. The journal and worker protocol include an operation priority now.
3. A separate reviewed migration may introduce child cgroups after restart and
   live-migration behavior is tested.
4. A sibling storage cgroup is not the target because it would weaken the
   combined per-project ceiling.

## Durable Local Journal

### Source of truth

A dedicated project-host SQLite database is the recovery source of truth for
execution. Conat LRO records are user-visible projections and may be unavailable
during exactly the outage in which recovery matters.

The journal must live outside project subvolumes on the persistent data disk,
for example
`$COCALC_DATA/storage-operations/operations.sqlite` where `COCALC_DATA`
resolves under `/mnt/cocalc/data` on managed hosts. It must move with the Btrfs
data disk if a failed VM is reconstructed and the disk is reattached. Enforced
mode fails closed if startup cannot prove that the journal path has the required
durability and ownership.

Use a dedicated connection rather than changing pragmas on the shared
project-host SQLite database. The general database currently uses WAL with
`synchronous=NORMAL`; this low-volume safety journal uses WAL, a busy timeout,
foreign keys, and `synchronous=FULL`. Table initialization follows the additive
pattern already used by
[`storage-reservations.ts`](../packages/project-host/storage-reservations.ts),
but the connection and file are independent. Schema migrations must be
additive and tested from every deployed predecessor version.

### Operation table

The proposed logical schema is:

```sql
CREATE TABLE project_storage_operations (
  op_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  host_id TEXT NOT NULL,
  placement_generation TEXT NOT NULL,
  kind TEXT NOT NULL,
  spec_version INTEGER NOT NULL,
  priority TEXT NOT NULL,
  mutation_mode TEXT NOT NULL,
  state TEXT NOT NULL,
  phase TEXT NOT NULL,
  checkpoint INTEGER NOT NULL DEFAULT 0,
  spec_json TEXT NOT NULL,
  progress_json TEXT,
  recovery_json TEXT,
  result_json TEXT,
  error_json TEXT,
  worker_pid INTEGER,
  worker_pid_start TEXT,
  worker_boot_id TEXT,
  worker_heartbeat_at INTEGER,
  lease_owner TEXT,
  lease_expires_at INTEGER,
  attempt INTEGER NOT NULL DEFAULT 0,
  lro_scope_type TEXT,
  lro_scope_id TEXT,
  created_at INTEGER NOT NULL,
  accepted_at INTEGER,
  started_at INTEGER,
  updated_at INTEGER NOT NULL,
  finished_at INTEGER,
  cleanup_after INTEGER
);
```

Required indexes cover `(state, updated_at)`, `(project_id, state)`,
`(lease_expires_at)`, and `(cleanup_after)`.

`spec_json` is immutable after acceptance. It contains normalized relative
paths, operation options, expected host assignment, limits, and references to
credentials or artifacts. It must never contain R2 secret keys, Cloudflare API
tokens, repository passwords, or browser credentials. Secrets are resolved
through root-owned versioned profiles at execution time.

The implementation also stores a canonical specification hash. A repeated
`op_id` is idempotent only when the kind, project, placement generation, schema
version, and canonical hash all match.

### Transition log

An append-only table records every safety-relevant transition:

```sql
CREATE TABLE project_storage_operation_events (
  event_id INTEGER PRIMARY KEY AUTOINCREMENT,
  op_id TEXT NOT NULL,
  checkpoint INTEGER NOT NULL,
  event TEXT NOT NULL,
  phase TEXT NOT NULL,
  detail_json TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(op_id) REFERENCES project_storage_operations(op_id)
);
```

This table is for recovery evidence and RCA, not high-volume per-file progress.
Progress is coalesced to a bounded update frequency.

### Durable project leases

Long operations require durable leases separate from in-memory mutexes:

```sql
CREATE TABLE project_storage_operation_leases (
  project_id TEXT NOT NULL,
  lease_class TEXT NOT NULL,
  op_id TEXT NOT NULL,
  fencing_token INTEGER NOT NULL,
  owner_boot_id TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY(project_id, lease_class)
);
```

Initial lease classes are `mutation` and `snapshot-transition`. Read workers use
bounded counters rather than an exclusive lease. Multiple-project operations
acquire leases in sorted project-ID order to prevent deadlock.

Lease expiry is not permission to launch a duplicate worker. A contender first
moves the operation into recovery and proves that the prior worker identity is
gone or safely adopted. Every lease renewal and worker command carries the
monotonic fencing token; progress or completion from an older token is ignored.

### State machine

```text
queued
  -> preparing
  -> running
  -> finalizing
  -> succeeded

queued/preparing/running/finalizing
  -> cancel_requested
  -> recovering
  -> canceled | failed | needs_operator

startup discovery of nonterminal state
  -> recovering
  -> queued | running | finalizing | failed | needs_operator
```

Terminal states are `succeeded`, `failed`, `canceled`, and `needs_operator`.
`needs_operator` means automatic repair could not prove a safe filesystem
state. It must alert, block conflicting operations for that project, and retain
all journal evidence.

Exactly-once atomicity across SQLite, Btrfs, and object storage is impossible.
Each transition therefore follows:

1. journal the intended transition;
2. perform the side effect;
3. inspect the real filesystem or remote object state;
4. journal the verified result.

Recovery repeats the inspection and performs an idempotent repair or retry.

## Worker Launch And Protocol

### No generic privileged execution

The privileged interface exposes a fixed operation enum with a versioned
schema. It must not accept an executable path, shell fragment, arbitrary
environment, arbitrary absolute root, or unrestricted Rustic arguments.

The initial operations should be narrow, for example:

```text
storage-worker-delete-v1
storage-worker-copy-v1
storage-worker-search-v1
storage-worker-archive-v1
storage-worker-rustic-backup-v1
storage-worker-rustic-restore-v1
```

Each operation has an explicit root policy, normalized relative paths, allowed
flags, timeout, output limit, and network policy. Existing path-helper and
Rustic wrappers should be extended or composed, not bypassed.

### Launch sequence

1. The coordinator validates the request subject, project ID, ownership,
   placement generation, operation schema, path policy, and admission limits.
2. It inserts or idempotently finds the operation by `op_id`.
3. It acquires the durable project lease and commits `preparing`.
4. It resolves the project's current service class and required cgroup policy.
5. The fixed launcher enters and verifies the project leaf, then emits a
   `READY` handshake without opening project data.
6. The coordinator independently verifies the PID and cgroup, records
   `/proc/<pid>/stat` start time, host boot ID, attempt, fencing token, and
   `running` state, then commits.
7. The coordinator sends a bounded `START` message containing the validated
   spec reference and hash. A worker that never receives `START` exits after a
   short timeout.
8. Only then does the worker open the project root through the
   descriptor-anchored helper or sandbox API.
9. The worker emits bounded structured progress and writes an atomic terminal
   result. The coordinator coalesces progress into SQLite and LRO events.
10. The coordinator verifies postconditions, finalizes safety state, releases
   reservations and leases, and marks the terminal state.

PID alone is never an identity because Linux can reuse it. Adoption requires a
matching PID start time, boot ID, operation ID, executable identity, and cgroup.

### Process behavior

- Set a new process group so cancellation reaches descendants.
- Sanitize environment and working directory.
- Use restrictive umask and close inherited file descriptors.
- Apply CPU, memory, and PID bounds in addition to `io.max`.
- Disable network for workers that do not need it. Backup workers receive only
  the repository endpoint and profile required for that operation.
- Rate-limit progress to avoid turning millions of entries into millions of
  SQLite writes or Conat messages.
- Cap stdout/stderr and preserve a bounded tail for diagnostics.
- Never deserialize executable code from project contents.

### Coordinator restart

A worker may outlive the coordinator. On startup, recovery checks the recorded
process identity:

- if the exact worker is alive in the expected cgroup, monitor it and inspect
  its atomic progress/result files;
- if identity cannot be proven, do not signal the PID as if it were the worker;
- if no worker is alive, inspect the operation's filesystem checkpoint and
  recover or requeue;
- if the host boot ID changed, no old PID can be adopted.

The worker protocol must permit progress loss without safety loss. Safety
checkpoints are coordinator journal transitions plus filesystem probes, not
volatile pipe messages.

## Authorization, Placement, And Fencing

The owning bay creates or reuses the stable `op_id` and sends the current host
assignment plus a monotonic placement generation. The project host verifies
that generation:

- before accepting the operation;
- before launching a worker;
- before every hazardous Btrfs or quota transition;
- before finalizing an operation that changes placement-visible state.

Project move and host drain must participate in the same protocol:

1. stop admitting new mutations;
2. wait for safe completion or request cancellation;
3. recover any hazardous intermediate state;
4. fence the old generation;
5. perform the move;
6. admit operations on the new generation.

A stale source host may finish an already safe read, but it may not begin a new
mutation after fencing. Destination restore operations carry both the move
`op_id` and the destination placement generation.

If an operator reconstructs a VM and reattaches its data disk, the new process
must not simply overwrite journal `host_id` values. It first verifies the data
disk identity, obtains an explicit takeover generation from the owning control
plane, fences the old host identity, and records an adoption event for each
nonterminal operation. Until then, it may inspect and restore strictly local
safety state, but it may not resume user-visible mutations.

## Scheduling And Admission

### Per-project limits

Initial policy:

- at most one Class C mutation per project;
- at most one snapshot transition per project;
- at most two Class B read workers per project;
- backups and scans yield to interactive file operations through class-aware
  queueing, not by weakening the hard project ceiling;
- cross-project mutations consume a slot and lease for every affected project.

### Host limits

The scheduler has independent queues for:

- interactive project reads;
- user-requested mutations;
- background backup and cleanup;
- host maintenance.

Each queue has explicit active-worker limits and a host-wide maximum. Launch is
deferred when any of these conditions crosses its configured threshold:

- block I/O PSI or sustained latency;
- Btrfs metadata pressure;
- disk admission free-space reserve;
- active storage reservations;
- project-host event-loop lag or stale heartbeat;
- too many active Btrfs transitions;
- host shutdown, drain, or preemption.

Hysteresis and cooldown prevent queue thrashing. Existing workers are not
blindly killed when pressure rises. The coordinator pauses new launches and
requests cooperative slowdown or cancellation only at operation-defined safe
points.

### Storage reservations

Operations that can increase local usage acquire a reservation tied to
`project_id` and `op_id`. Extend the existing reservation kinds for copy,
archive extraction, move staging, and snapshot restore. Recovery releases a
reservation only after it proves that temporary data is gone or retained as an
intentional result.

## Detailed Operation Designs

### Recursive live-file deletion

#### First release

Use the existing native descriptor-anchored delete helper in a durable worker
for recursive requests. Direct deletion is idempotent when `force` semantics
are requested: recovery verifies absence and retries remaining entries.

The operation records:

- project root type (`home` or `scratch`);
- normalized relative target;
- recursive and force flags;
- target identity captured by a descriptor-safe probe where practical;
- counters and bounded diagnostics;
- cancellation and postcondition state.

Deleting the project root remains forbidden. Symlinks are not followed outside
the root. The UI may return an LRO immediately for a recursive request rather
than holding one RPC open for hours.

#### Optional atomic trash

Atomic rename to `.cocalc-trash/<op_id>` can make a user-visible delete nearly
instant, but it is not enabled initially. A same-subvolume rename is atomic;
moving to a separate subvolume is not and generally returns `EXDEV`.

Before atomic trash is enabled, staging must prove all of the following:

- `.cocalc-trash` is hidden from normal listings and excluded from Rustic
  backups and archive exports;
- snapshot creation and backup snapshot creation take the project mutation
  lease and cannot capture nonempty trash;
- restart recovery drains trash before allowing a new snapshot;
- quota accounting and low-space behavior remain safe;
- conflicting recreation of the original path has defined semantics;
- old clients cannot accidentally expose or restore trash.

If those conditions are not met, keep direct worker deletion.

### Snapshot path pruning

Snapshot pruning is the highest-priority durable state machine because it
combines project-controlled traversal with temporary privileged state.

The operation captures the exact selected snapshot names and their initial
read-only state. It then executes these checkpoints:

```text
validate project, path, generation, and snapshot set
acquire project mutation and snapshot-transition leases
record original quota state
record intent to apply temporary quota relief
apply quota relief and verify actual quota
for each snapshot:
  record intent to make snapshot writable
  make writable under a short Btrfs transition lock
  verify writable state
  run project-attributed recursive delete worker
  verify target absence or defined force result
  record intent to restore read-only state
  restore read-only state under a short Btrfs transition lock
  verify read-only state
record intent to restore original quota
restore original quota and verify
release leases
mark succeeded
```

The global Btrfs mutation lock must not surround the recursive traversal. It is
held only for short subvolume, read-only, and quota transitions. If staging
shows that the deployed Btrfs/qgroup implementation requires wider
serialization for correctness, use a dedicated bounded host Btrfs queue while
the traversal still runs outside the control process. Do not silently restore
the hours-long in-process critical section.

Recovery always restores safety before resuming user work:

1. inspect actual quota and every selected snapshot's read-only state;
2. if a delete worker is verifiably alive, monitor it or request a safe stop;
3. restore any writable snapshot unless the state machine is deliberately
   resuming its deletion;
4. restore the original quota;
5. revalidate placement and leases;
6. retry remaining snapshots or mark `needs_operator` with an alert.

No terminal success is reported until every snapshot and quota postcondition is
verified.

### Copy and move

Same-project recursive copy runs in that project's worker. It streams data,
does not buffer whole files, preserves the existing option contract, and
records temporary destinations so recovery can remove or resume them.

Cross-project copy requires leases in sorted order. A single process cannot
charge source reads and destination writes to two cgroups. The target design is
a bounded two-worker pipeline:

- source reader/archiver in the source project cgroup;
- destination writer/extractor in the destination project cgroup;
- bounded pipe or bounded reserved spool, never an unbounded hub buffer;
- hashes and counts verified at the destination;
- destination publication by atomic rename where filesystem semantics permit.

For a local Btrfs reflink fast path, measure actual cgroup attribution and
metadata behavior. Charge the operation to the destination and retain both
project leases. If reflink metadata work is not adequately attributable, route
it through a bounded privileged transition queue.

`move` is rename-only when the verified source and destination permit an atomic
rename. Any cross-device fallback becomes a durable copy-plus-verify-plus-delete
state machine. It must never silently recurse in the shared Node process.

### Archive creation and extraction

Archive creation uses a streaming worker and a hard tuple of limits:

- maximum source entries;
- maximum uncompressed bytes;
- maximum compressed bytes;
- maximum wall time;
- maximum output and diagnostic bytes.

The coordinator must not accumulate the complete tar-gzip archive in a Buffer.
Small cross-host archives may use a bounded stream; larger copies use durable
object storage and an LRO.

Extraction requires a storage reservation, rejects absolute and traversal
paths, bounds expansion ratio and entry count, writes into an operation staging
directory, verifies the result, and publishes atomically when possible.
Cancellation and failure clean staging through the same journal.

### Backup and restore

Extend the existing `project-rustic-backup` and `project-rustic-restore`
wrappers so they attach and verify the project cgroup before `cd`, scanning,
network transfer, or extraction.

Backup is a durable read operation because it may create and clean temporary
snapshots and remote objects. Restore is a durable mutation with a storage
reservation and staging publication.

Requirements:

- stable `op_id` across retries from project move and backup workflows;
- credential profile reference, not credentials in the journal;
- bounded Rustic JSON/output parsing;
- explicit retry classification for R2 429, transient network failure,
  authorization failure, missing repository, and local ENOSPC;
- remote idempotency based on deterministic tags/object keys where supported;
- no retry loop in the shared event loop that hides operation state;
- cleanup and postcondition checks after process or host restart.

Pending project copies and project moves should compose source backup and
destination restore operations rather than maintaining a separate unsafe
execution path.

### Snapshot restore and legacy remediation

Snapshot restore, legacy archive restore, and remediation apply already contain
staging and safety-snapshot concepts. Convert each into an explicit journaled
state machine. Every temporary subvolume or directory is named from `op_id` so
recovery can distinguish owned staging from unrelated data.

Publication transitions must record old and new subvolume identities before
rename/swap. Recovery probes which identity is live and either completes the
swap or restores the prior one. It never guesses based only on the last logged
message.

### Searches and disk-usage scans

`find`, `fd`, `ripgrep`, `du`, and `dust` move to Class B workers. Existing
timeouts remain upper bounds, not the only protection. Add:

- project cgroup attachment proof;
- process-group cancellation;
- output and result-count caps;
- host and project concurrency slots;
- bounded stderr;
- metrics for bytes read when available, entries/results, timeout, and cgroup
  I/O deltas.

These operations are read-only and need no durable recovery journal.

### Directory listings

Replace collect-all behavior with a paginated, bounded implementation:

- stream at most `limit + 1` names;
- lstat with a fixed small concurrency, such as 16 or 32;
- return a continuation token tied to directory identity and ordering policy;
- report truncation explicitly;
- bound symlink target reads and serialized response size;
- treat mutation races as normal and never allocate one promise per entry.

The legacy listing API may initially apply a conservative cap and return
`truncated=true`. Frontend paging support should land before lowering any cap
that would surprise normal users.

### Ordinary file transfers

The normal file service must remain direct browser-to-project-host data plane.
The first hardening step is to document and enforce limits on:

- bytes per read/write RPC;
- active streams per project and host;
- buffered bytes per stream and process;
- upload/download duration and idle timeout;
- decompressed or transformed output;
- aggregate in-flight memory.

Requests below a deliberately small bound may remain Class A because their
worst case is bounded. Larger transfers should use a supervised project
transfer worker or direct object-storage flow. The coordinator must provide
backpressure rather than buffering a full project-selected file.

### Host maintenance

Audit every recursive operation under `backend/sandbox`, `file-server/btrfs`,
and `project-host`. If no single project owns the cost, move it to the Class D
maintenance pool. Initial candidates include:

- OCI and rootfs cache scans and pruning;
- old artifact and upgrade cleanup;
- shared backup-index compaction;
- orphan staging cleanup;
- Codex cache GC;
- any global `find`, `du`, `rm -rf`, Rustic, tar, or rsync invocation.

BEES remains independently constrained. Class D must not share BEES's cgroup or
limits because the workloads and operational controls differ.

## LRO And API Integration

Reuse `LroRef` and the existing project-host LRO stream in
[`lro/stream.ts`](../packages/project-host/lro/stream.ts). Do not invent another
frontend progress system.

For durable operations:

- the authoritative caller supplies `op_id`, scope type, and scope ID;
- repeated submission with the same `op_id` and identical immutable spec
  returns the existing operation;
- repeated submission with a different spec is a conflict;
- disconnecting the RPC does not cancel accepted work;
- cancellation is an explicit operation and may become `cancel_requested`
  until a safe point;
- LRO summaries are rebuilt from the local journal after reconnect;
- terminal results remain queryable for a retention window.

During migration, existing `Promise<void>` file-server methods may submit a
durable operation and await its terminal state internally. New callers should
receive an operation reference immediately. Destructive retries must never
fall back to legacy execution after a durable operation has been accepted.

## Recovery And Failure Semantics

### Startup recovery

Project-host startup performs a bounded recovery scan before accepting
conflicting mutations:

1. load nonterminal operations and expired leases;
2. compare recorded and current host boot IDs;
3. identify live workers using PID start time, executable, cgroup, and op ID;
4. inspect operation-specific filesystem postconditions;
5. restore hazardous quota/read-only/publication state first;
6. reacquire leases with a new fencing token;
7. adopt, requeue, finalize, fail, or mark `needs_operator`;
8. republish LRO summaries when Conat is available.

Recovery work itself is bounded and pressure-aware. It does not launch every
pending operation simultaneously after reboot.

### Failure classes

Each error is classified as one of:

- retryable external: timeout, R2 429/5xx, temporary DNS/network failure;
- retryable local: worker crash, transient lock contention, restart;
- admission: insufficient disk or metadata reserve, host pressure;
- permanent request: invalid path, unsupported option, missing source;
- authorization/fencing: stale generation, revoked access, wrong host;
- safety invariant: cannot restore read-only/quota/publication state;
- operator-required: ambiguous filesystem state or repeated repair failure.

Retries use bounded exponential backoff and a maximum attempt/deadline policy.
Safety repair is not abandoned merely because the user-visible operation
deadline expired.

### Shutdown and preemption

On drain, shutdown, or preemption notice:

- stop accepting new Class C operations;
- request workers to checkpoint or stop at a safe boundary;
- persist fresh progress and process identity;
- restore any temporary hazardous state that can be restored within the
  deadline;
- leave explicit recovery records for the next boot;
- never mark success merely because shutdown interrupted observation.

## Telemetry And Operations

### Metrics

Expose bounded aggregate metrics and a small top-N sample:

- queued, active, recovering, and `needs_operator` counts by kind/class;
- queue age and execution duration histograms;
- worker launch, attach, and cgroup verification failures;
- active workers by project and priority;
- bytes/entries processed where available;
- operation cgroup `io.stat` deltas;
- cancellations, retries, and recovery attempts;
- time spent with temporary quota relief or writable snapshots;
- SQLite journal latency/errors and oldest heartbeat age;
- pressure-based admission pauses;
- maintenance-pool utilization.

Metrics collection must never enumerate every operation or cgroup on every
short interval. Keep summaries incrementally and expose staleness.

### Alerts

Page or create an operator alert for:

- any `needs_operator` operation;
- a snapshot left writable beyond its transition deadline;
- quota relief active beyond its deadline;
- a worker outside its expected project cgroup;
- repeated journal write failure;
- stale active-worker heartbeat with no successful recovery;
- a queue older than its service objective;
- project-host event-loop or heartbeat degradation during storage work.

### Operator interface

Add read-only commands first:

```text
cocalc host storage-operations list --host <host>
cocalc host storage-operations show --host <host> --op-id <id>
cocalc host storage-operations health --host <host>
```

Fresh-auth guarded mutations may later include cancel, retry, and explicit
repair. They operate through typed control-plane APIs and journal every action;
they do not expose SSH commands or arbitrary helper arguments.

## Feature Flags And Defaults

All Phase 2 execution is off by default, even if its code is present in an
artifact.

Proposed host policy:

```text
COCALC_PROJECT_STORAGE_OPERATIONS_MODE=disabled|observe|canary|enforce
COCALC_PROJECT_STORAGE_OPERATIONS_KINDS=recursive-delete,snapshot-prune,...
COCALC_PROJECT_STORAGE_OPERATIONS_CANARY_PROJECT_IDS=<comma-separated UUIDs>
COCALC_PROJECT_STORAGE_OPERATIONS_MAX_ACTIVE=<integer>
COCALC_PROJECT_STORAGE_MAINTENANCE_MODE=disabled|observe|enforce
```

Semantics:

- `disabled`: do not initialize new execution paths; retain journal recovery
  support for operations accepted by an earlier mode.
- `observe`: classify requests, emit intended scheduling/attribution metrics,
  and execute the legacy path. It must not claim containment.
- `canary`: use new execution only for both an enabled kind and allowlisted
  project/host.
- `enforce`: use new execution for enabled kinds and fail closed when required
  safety checks cannot be established.

The flags must be present in explicit desired state and visible in host health.
An absent or malformed value means `disabled`. A source-code merge or artifact
upgrade alone cannot enable Phase 2.

Disabling new admission does not abandon already accepted destructive work.
Existing operations drain or enter recovery until the filesystem is safe.

## Implementation Plan

The implementation should land as small reviewable commits. Each stage remains
disabled by default and includes its focused tests.

### PR 0: complete inventory and contracts

1. Add an operation-class annotation or registry for every sandbox and
   project-host storage API.
2. Add tests that fail when a new data-dependent operation is not classified.
3. Add hard bounds to directory listing and whole-file buffer paths where
   possible without worker support.
4. Document current transfer byte/concurrency limits and close obvious
   unlimited cases.
5. Add observe-only metrics for operation kind, project, duration, timeout, and
   execution cgroup.

Likely files:

- `packages/backend/sandbox/index.ts`
- `packages/backend/sandbox/get-listing.ts`
- `packages/project-host/file-server.ts`
- `packages/conat/files/file-server.ts`
- new `packages/project-host/storage-operations/classification.ts`

### PR 1: journal and coordinator core

1. Add schemas, migrations, typed operation specs, transition validation, and
   retention GC.
2. Implement idempotent submit/get/list/cancel APIs.
3. Implement durable project leases and fencing tokens.
4. Connect local state to existing LRO publishing.
5. Add startup recovery skeleton and operator health diagnostics.
6. Keep execution mode `disabled`.

Suggested modules:

```text
packages/project-host/storage-operations/types.ts
packages/project-host/storage-operations/journal.ts
packages/project-host/storage-operations/state-machine.ts
packages/project-host/storage-operations/leases.ts
packages/project-host/storage-operations/coordinator.ts
packages/project-host/storage-operations/recovery.ts
packages/project-host/storage-operations/lro.ts
packages/project-host/storage-operations/metrics.ts
```

### PR 2: worker launcher and transient reads

1. Add the fixed worker protocol and privileged attachment helper.
2. Prove cgroup membership before opening project data.
3. Move find/fd/ripgrep/du/dust to supervised Class B workers.
4. Add process-group cancellation and output bounds.
5. Add a dedicated maintenance cgroup and one harmless maintenance canary.
6. Validate on projects that are stopped and running.

### PR 3: durable recursive delete

1. Wrap the existing native delete helper in the durable coordinator.
2. Add LRO progress, cancellation, retries, and postcondition verification.
3. Make recursive frontend deletion submit an operation rather than hold a
   synchronous RPC indefinitely.
4. Test millions of files, project-host restart, worker kill, and host reboot.
5. Keep atomic trash disabled.

### PR 4: durable snapshot pruning

1. Implement the transition-by-transition journal described above.
2. Shorten the global Btrfs lock scope.
3. Add quota/read-only state probes and startup repair.
4. Inject failure before and after every checkpoint.
5. Block conflicting snapshots, backups, restores, moves, and deletion through
   durable leases.

### PR 5: copy, move, and archive pipelines

1. Eliminate recursive Node copy and whole-archive buffering.
2. Implement staging, reservations, hashing, and atomic publication.
3. Add two-project sorted locking and, where needed, two-worker attribution.
4. Convert cross-device move fallback to a durable state machine.
5. Preserve existing path safety and copy-option behavior.

### PR 6: Rustic, backup, restore, and project moves

1. Attach Rustic backup/restore to project cgroups before data access.
2. Convert pending-copy and move stages to durable child operations sharing the
   control-plane move `op_id` hierarchy.
3. Add explicit remote retry classification and deterministic idempotency.
4. Integrate storage reservations and staging cleanup recovery.
5. Test cross-region and same-host moves, including repeated user retries.

### PR 7: snapshot restore and legacy remediation

1. Journal subvolume staging, swap, safety snapshot, and cleanup phases.
2. Add actual-state recovery for every rename/subvolume transition.
3. Move archive extraction and recursive remediation into workers.

### PR 8: transfers and remaining maintenance

1. Finish the sandbox/project-host recursive-operation audit.
2. Add transfer bounds and worker path for large file streams.
3. Move every global recursive maintenance path to Class D.
4. Decide, from measurements, whether a runtime/storage child-cgroup migration
   is worth its complexity.

## Test Plan

### Unit and state-machine tests

- every allowed and forbidden state transition;
- idempotent duplicate submission and spec conflict;
- lease acquisition, expiry, fencing, sorted multi-project locking;
- journal migration from an empty and predecessor database;
- retention without deleting nonterminal or `needs_operator` evidence;
- error classification and retry deadlines;
- LRO reconstruction from journal state;
- placement-generation mismatch at every gate.

### Security tests

- absolute paths, `..`, empty components, symlink swaps, bind-mount surprises,
  and rename races;
- source and destination resolving to the same inode;
- archive traversal, absolute entries, symlink/hardlink escapes, device files,
  and decompression bombs;
- malformed operation specs and unknown versions;
- attempted generic command/environment injection;
- worker proves cgroup membership before any project file descriptor opens;
- every descendant remains in the expected cgroup;
- worker for project A cannot name project B's root;
- stale PID cannot be adopted after reuse or reboot;
- journal and progress files cannot contain credentials.

### Resource stress tests

- five million zero-byte files;
- large sequential direct reads and writes;
- random 4 KiB I/O and metadata-heavy create/unlink;
- deeply nested trees and wide directories;
- large sparse and non-sparse files;
- high-compression and low-compression archives;
- concurrent runtime I/O plus delete, scan, backup, and restore;
- several projects contending up to the aggregate pool ceiling;
- maintenance work contending with active projects.

For every case, record:

- project and pool `io.stat`/`io.max`;
- host and cgroup PSI;
- project-host event-loop lag and heartbeat age;
- unrelated project listing, terminal, and WebSocket latency;
- memory, PID, and output bounds;
- Btrfs data and metadata state.

### Failure injection matrix

Kill or fail the worker, coordinator, and host at every safety checkpoint:

- before and after journal intent;
- before and after cgroup attachment;
- during traversal;
- before and after making a snapshot writable;
- before and after quota relief;
- before and after staging publication;
- during Rustic upload/download;
- before and after remote object creation;
- during cleanup and lease release.

Also inject:

- host reboot and GCP preemption;
- SQLite busy, I/O error, full disk, and corrupt-row handling;
- Btrfs ENOSPC and metadata exhaustion;
- R2 429, 401/403, timeout, truncated JSON, and connection reset;
- Conat disconnect and owning-bay restart;
- project start/stop/restart/move during an operation;
- VM reconstruction with the persistent data disk and journal attached to a
  replacement host identity;
- software upgrade with old nonterminal journal rows;
- unsupported cgroup controller and device reattachment.

After each fault, automatically assert:

- no snapshot remains unexpectedly writable;
- the original quota is restored or the project is blocked as
  `needs_operator`;
- no ambiguous staging tree is published;
- no operation executes twice concurrently;
- no worker escaped the expected cgroup;
- unrelated projects and host health remain responsive;
- the operation resumes, fails clearly, or requires explicit operator action.

### Provider validation

Run the complete containment and recovery matrix on at least:

- staging GCP with the actual Btrfs data-disk topology;
- one Nebius staging/canary host;
- a host with a stopped project and no preexisting leaf;
- a host reboot where device major/minor changes;
- any supported multi-device or mapped-device topology before claiming support.

Unsupported topology must be explicit and fail closed for new enforced
operations.

## Rollout Plan

Each operation kind advances independently:

1. local unit, integration, and fault-injection tests;
2. staging `disabled` deployment to prove artifact compatibility;
3. staging `observe` classification and metrics;
4. one canary project on the lower-risk staging host;
5. destructive stress and restart tests on that canary;
6. both staging hosts with all normal workflows exercised;
7. at least 24 hours of soak with no safety leaks or control-plane regression;
8. reviewed evidence document and explicit approval;
9. one low-risk production host and operator-owned project;
10. bounded production waves with a pause between hosts;
11. fleet enablement only after metrics and support behavior are normal.

Rollout artifacts must be built from an exact reviewed commit, and the desired
mode/kinds must be recorded separately from artifact version. This prevents an
unrelated frontend, hub, or project-host release from enabling unfinished I/O
work.

Rollback order:

1. set admission to `disabled` for the affected kind;
2. keep recovery code active;
3. drain safe operations and repair hazardous transitions;
4. verify journal, snapshots, quota, workers, and cgroups;
5. revert routing to legacy only for operations that were never accepted by
   the durable path;
6. retain evidence for RCA.

## Acceptance Criteria

Phase 2 is complete only when all of these are true:

1. No unbounded project-content traversal or whole-file/archive buffering runs
   in the shared project-host process.
2. Every Class B/C worker and descendant is proven to be in the expected
   project cgroup before touching project data.
3. Every global recursive maintenance operation runs in a bounded maintenance
   cgroup.
4. Recursive deletion of at least five million files does not make unrelated
   terminals, listings, WebSockets, or host health unavailable.
5. Worker kill, project-host kill, and host reboot at every snapshot-prune
   checkpoint leave no unaccounted writable snapshot or quota relief.
6. Durable operations resume or terminate in a clear, queryable state; ambiguous
   state becomes `needs_operator` and alerts.
7. Cross-project/cross-host work has explicit source and destination
   attribution, locks, reservations, and placement fencing.
8. Directory listings and file-transfer buffering have hard cardinality and
   memory bounds.
9. Existing normal file, terminal, Jupyter, Codex, backup, restore, and project
   move behavior remains compatible.
10. Disabling Phase 2 admission cannot abandon an accepted destructive
    operation in a hazardous state.
11. GCP and Nebius capability and stress evidence is documented separately.
12. Production rollout is explicitly approved after staging evidence review.

## Open Decisions Requiring Measurement Or Review

1. Exact host and per-project worker concurrency by provider profile.
2. Threshold between bounded inline/transient operations and durable LROs.
3. Whether progress can be estimated reliably enough to show percentages or
   should remain entry/byte counters plus indeterminate status.
4. Whether atomic trash is worth its snapshot and quota complexity.
5. Whether Btrfs/qgroup correctness permits releasing the global mutation lock
   during recursive snapshot-path deletion on every supported kernel.
6. Whether local reflink operations are adequately charged to the selected
   project cgroup.
7. Whether runtime/storage child cgroups improve user experience enough to
   justify the live hierarchy migration.
8. Transfer-worker IPC design for large direct browser uploads/downloads.
9. Journal terminal-state retention and operator evidence retention periods.
10. The placement-generation representation to add to existing host routing and
    project-move contracts.

None of these decisions prevents implementing the journal, launcher,
classification registry, transient read workers, or direct-delete canary.

## Recommended Immediate Work

1. Keep the validated Phase 1 static-containment production decision separate.
2. Implement PR 0 and PR 1 with all execution flags defaulting to `disabled`.
3. Add the bounded paginated listing fix early because it removes a direct
   shared-process cardinality hazard without waiting for the full worker stack.
4. Generalize the already proven recursive-delete cgroup attachment into the
   fixed worker launcher.
5. Canary durable recursive delete before snapshot prune.
6. Implement snapshot-prune recovery next, with failure injection at every
   quota and read-only checkpoint.
7. Do not begin copy/archive/Rustic migration until journal recovery and worker
   attachment have passed reboot tests.

This order gives immediate host-safety value while keeping the most hazardous
filesystem transitions behind explicit flags and review gates.
