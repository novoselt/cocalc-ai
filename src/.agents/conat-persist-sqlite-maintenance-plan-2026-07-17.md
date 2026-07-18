# Conat Persist SQLite Maintenance Plan

Date: 2026-07-17

Status: proposed implementation and deployment plan

## Executive Summary

Commit `0da3e3e7ae988598e782b72ca965e462acfc9e78` correctly removed
full `VACUUM` operations from live Conat persist close and delete paths. The
old behavior ran expensive synchronous compaction during ordinary client
disconnects and could overlap a reopen of the same path. SQLite can reuse free
pages, so removing that behavior was the correct emergency fix.

The follow-up should be a separate, conservative SQLite maintenance system
shared by both Conat persist deployments:

- project-host persist, whose databases are primarily under each project's
  `.local/share/cocalc/persist` tree;
- bay persist, whose project-independent account, host, and hub databases are
  under the bay sync storage roots.

The maintenance system should have one rebuildable catalog per host or bay,
one coordinator per storage domain, and a rate-limited compaction loop.
Compaction should build a replacement using `VACUUM INTO`, leave the source
untouched while that work runs, and atomically promote the replacement only
after proving that the source has not opened or changed.

The catalog is advisory inventory and coordination state. It is not a source
of truth. Projects can be moved, archived, restored, or deleted, and users can
delete their edit history or the underlying hidden files. Missing catalog
paths are expected and must never cause maintenance to recreate or restore a
database.

## Why This Work Matters

### Risk If We Do Nothing

SQLite normally reuses free pages, so the absence of `VACUUM` does not imply
that every steady-state workload grows without bound. It does mean that a
database generally retains its historical high-water allocation after a large
amount of data is deleted.

That creates several accumulating costs:

1. **User-visible quota waste.** Project Conat persist databases live inside
   the project filesystem. A user can delete a large edit history or other
   stream contents and reasonably expect the space to become available, while
   SQLite may continue to reserve most of those pages in the database file.
   Hidden implementation storage can therefore consume project quota even
   though the corresponding user-visible history is gone.
2. **Reduced project-host capacity.** Retained high-water files consume btrfs
   data extents, reduce admission headroom, trigger earlier disk growth, and
   lower the number of projects that fit safely on a host.
3. **Larger and slower backups.** Project and bay backups may process and retain
   pages that no longer contain live records. This increases local read I/O,
   object-storage transfer, backup duration, and retained cloud storage.
4. **Bay storage growth.** Account, host, hub, notification, and operational
   streams can similarly retain deleted pages on bay storage.
5. **Operational confusion.** A project may appear unexpectedly full after a
   user deletes history, leading to failed writes, support requests, manual
   intervention, or unnecessary quota increases.

The risk is primarily unfair disk retention, cost, and capacity pressure, not
an immediate data-integrity failure. The effect is workload-dependent and
should be measured before selecting final thresholds.

### Risk Of A Poor Maintenance Implementation

An aggressive or incorrectly coordinated compactor is more dangerous than
doing nothing. It could:

- block the synchronous persist worker and stall unrelated projects;
- reopen a path while its previous SQLite connection is closing;
- replace a database while another process still has the old inode open;
- race a project move, restore, deletion, or history reset;
- restore an intentionally deleted database from catalog state;
- overwrite newer archive data with an old compacted snapshot;
- exhaust disk by creating large temporary copies;
- amplify I/O across every host at the same time;
- turn loss or corruption of the maintenance catalog into user-data loss.

The design below makes availability and source-database safety stronger than
space reclamation. If maintenance cannot prove that a promotion is safe, it
must discard its temporary work.

## Current Architecture

### Database Lifecycle

`getStream` validates a logical storage path, resolves it to a local physical
path, creates parent directories, and calls the synchronous `pstream` cache.
The physical database is the resolved path with `.db` appended.

`PersistentStream` currently:

- opens the database using Node's synchronous SQLite implementation;
- enables WAL and a busy timeout;
- remains in a process-local reference-counted cache while clients use it;
- performs a full WAL checkpoint on final close;
- closes the SQLite handle synchronously;
- copies the closed primary file to configured archive or backup paths;
- removes the path from the process-local `openPaths` set.

`openPaths` and the ref cache only describe the current process. They do not
provide durable discovery, history, or cross-worker coordination.

### Storage Topologies

Project hosts configure a project template similar to:

```text
/mnt/cocalc/project-[project_id]/.local/share/cocalc/persist
```

The catalog itself must not live under a project path. It should use the
host-controlled `syncFiles.local` or data directory, for example:

```text
${syncFiles.local}/.maintenance/catalog.sqlite
```

Bay persist uses the same Conat persist storage implementation but can run
multiple forked persist workers against common bay storage. The load balancer
normally gives a scope stable worker affinity, but correctness must not depend
on that affinity never changing.

## Goals

1. Reclaim materially wasted SQLite pages without affecting normal persist
   latency.
2. Work for both project-host and bay persist deployments.
3. Never run long synchronous maintenance in a persist data-plane process.
4. Never promote a compact copy when the source may be open or changed.
5. Treat missing, moved, replaced, and intentionally deleted files as normal.
6. Keep normal stream service available if the catalog or coordinator fails.
7. Make the catalog fully reconstructible from normal opens and bounded
   filesystem scans.
8. Bound temporary disk, I/O, concurrency, execution time, and retry rate.
9. Expose enough status to understand reclaimed bytes, skipped candidates,
   errors, and scan coverage before enabling mutation.

## Non-Goals

- The catalog is not a global cluster inventory in PostgreSQL.
- The catalog is not authoritative project ownership metadata.
- Maintenance does not restore missing databases.
- Maintenance does not move project data between hosts.
- Maintenance does not compact databases currently open for collaboration.
- The first release does not attempt to compact every small SQLite database.
- The first release does not switch all databases to SQLite incremental
  auto-vacuum.

## Safety Invariants

1. The original database remains untouched while the expensive compact copy is
   built.
2. Only the coordinator may promote a compact copy.
3. Promotion requires a current file identity, unchanged generation, no open
   owners, and a valid compact output.
4. A missing path is never opened or created by maintenance.
5. A catalog failure disables promotion; it does not prevent normal stream
   serving.
6. A coordinator crash cannot promote a child process's temporary output.
7. Temporary and rollback files are on the same filesystem as the source when
   atomic rename is required.
8. Maintenance never follows symlinks and never operates outside configured,
   canonical storage roots.
9. Archive and backup refresh failures cannot roll back or invalidate a valid
   primary database.
10. Every loop is bounded by candidate count, bytes, concurrency, and time.

## Proposed Components

### Code And Package Boundaries

Relevant existing integration points:

- `packages/conat/persist/storage.ts`: `PersistentStream`, synchronous close,
  `openPaths`, and the ref-counted `pstream` cache;
- `packages/conat/persist/util.ts`: logical-to-physical path resolution and
  `getStream`;
- `packages/conat/persist/server.ts`: per-socket stream initialization and
  close;
- `packages/conat/persist/load-balancer.ts`: bay persist worker affinity;
- `packages/backend/conat/persist.ts`: Node SQLite and filesystem context;
- `packages/project-host/conat-persist.ts`: standalone project-host persist
  entry point and health endpoint;
- `packages/server/conat/persist/index.ts`: bay persist topology;
- `packages/server/conat/persist/start-server.ts`: forked bay persist worker
  supervision;
- `packages/backend/data.ts`: sync roots and archive/backup configuration;
- `packages/server/cloud/bootstrap-host.ts`: project-host persist root
  configuration.

Suggested new modules:

```text
packages/conat/persist/maintenance/types.ts
packages/conat/persist/maintenance/protocol.ts
packages/conat/persist/maintenance/candidates.ts

packages/backend/conat/persist-maintenance/catalog.ts
packages/backend/conat/persist-maintenance/coordinator.ts
packages/backend/conat/persist-maintenance/scanner.ts
packages/backend/conat/persist-maintenance/compact-worker.ts
packages/backend/conat/persist-maintenance/path-safety.ts
packages/backend/conat/persist-maintenance/status.ts
```

The portable Conat package should contain only types, state-machine rules, and
candidate calculations. Node-specific SQLite, process, `/proc`, filesystem,
priority, and IPC code belongs in backend. Project-host and server packages
should compose those modules rather than duplicating maintenance logic.

Add optional maintenance lifecycle hooks to the persist server construction
rather than introducing a hard dependency from generic storage onto a global
coordinator. The integration should work as follows:

1. `server.ts` asks the hooks to begin a tracked use after path authorization
   and resolution but before calling `pstream`.
2. Every socket use increments catalog generation conservatively.
3. The first underlying `PersistentStream` construction installs an
   internal-only final-close callback for that process and path.
4. Socket close continues calling the ref-counted `stream.close` wrapper.
5. The maintenance owner is removed only when refcount reaches zero and the
   underlying SQLite handle has actually closed.
6. Constructor/open failure sends an abort event and removes the owner.
7. Ephemeral in-memory streams bypass the catalog completely.

The owner table represents one underlying process/path handle, not one row per
socket. Multiple sockets can increment generation and share the same owner
until the final ref-cache close. This distinction is essential; removing the
owner on every socket close would permit promotion while another client still
uses the shared SQLite connection.

### 1. Rebuildable Local Catalog

Create a small raw SQLite catalog owned by the maintenance coordinator. Do not
store the catalog through Conat persist, since that would create a circular
dependency.

Recommended location:

```text
COCALC_PERSIST_MAINTENANCE_DB, if configured
otherwise ${syncFiles.local}/.maintenance/catalog.sqlite
```

The location must be host-controlled, persistent across daemon restarts, and
outside all project roots. The catalog should use WAL, `synchronous=NORMAL`, a
bounded busy timeout, and incremental auto-vacuum from initial creation. Its
tables are bounded and reconstructible, so its own space use should remain
small.

Suggested schema:

```sql
CREATE TABLE databases (
  path_key TEXT PRIMARY KEY,
  logical_path TEXT,
  physical_path TEXT NOT NULL,
  scope_type TEXT,
  scope_id TEXT,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  last_opened_at INTEGER,
  last_closed_at INTEGER,
  last_mutation_at INTEGER,
  generation INTEGER NOT NULL DEFAULT 0,
  presence_state TEXT NOT NULL,
  missing_since INTEGER,
  device INTEGER,
  inode INTEGER,
  file_size_bytes INTEGER,
  file_mtime_ms INTEGER,
  wal_size_bytes INTEGER,
  page_size INTEGER,
  page_count INTEGER,
  freelist_count INTEGER,
  reclaimable_bytes INTEGER,
  last_inspected_at INTEGER,
  last_compacted_at INTEGER,
  last_compact_before_bytes INTEGER,
  last_compact_after_bytes INTEGER,
  last_compact_duration_ms INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  retry_after INTEGER,
  last_error TEXT
);

CREATE TABLE open_owners (
  path_key TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  pid INTEGER NOT NULL,
  process_start_token TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  last_confirmed_at INTEGER NOT NULL,
  PRIMARY KEY (path_key, owner_id)
);

CREATE TABLE maintenance_runs (
  run_id TEXT PRIMARY KEY,
  path_key TEXT NOT NULL,
  state TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER,
  source_generation INTEGER NOT NULL,
  source_device INTEGER,
  source_inode INTEGER,
  source_size_bytes INTEGER,
  expected_reclaim_bytes INTEGER,
  reclaimed_bytes INTEGER,
  duration_ms INTEGER,
  reason TEXT,
  error TEXT
);

CREATE TABLE catalog_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
```

`maintenance_runs` should be pruned by age and count. It is diagnostic history,
not an unbounded event log.

`path_key` should be a stable hash of the canonical physical path. The full
path remains in the row for diagnostics and validation.

### 2. Maintenance Coordinator

Run exactly one coordinator for each host or bay storage domain.

Responsibilities:

- own the catalog connection;
- accept local worker lifecycle events;
- track expected persist workers and their sessions;
- maintain open-owner records;
- perform bounded discovery scans;
- select and inspect candidates;
- start compact-copy workers;
- validate and promote successful copies;
- update status and metrics;
- clean abandoned temporary files;
- enforce all load, disk, concurrency, and cooldown limits.

Project-host mode can host the coordinator in the standalone persist daemon,
provided expensive SQLite work always runs outside its main event loop. Bay
cluster mode should put the coordinator in the persist parent or a dedicated
locally supervised process, with forked persist workers using IPC or a Unix
domain socket.

The coordinator is not a data-plane dependency:

- if it is down, no promotion can occur;
- workers continue opening databases;
- workers log and count untracked opens;
- after restart, maintenance stays disabled until workers have registered and
  catalog state has reconciled.

To make fail-open safe, the coordinator must permit promotion only while every
expected persist worker has a healthy tracking session. If a worker loses its
coordinator session, the coordinator immediately cancels promotion eligibility.
A worker that times out registering an open should close its coordinator
session before proceeding, ensuring the coordinator sees the loss of coverage.

### 3. Compact-Copy Worker

The coordinator starts at most one low-priority worker per storage domain. The
worker receives already validated paths through structured IPC, never through
a shell command.

The worker may:

1. Open the source read-only where possible.
2. Read `page_size`, `page_count`, `freelist_count`, and `quick_check`.
3. Exit without mutation if the exact eligibility threshold is no longer met.
4. Run `VACUUM INTO` to a unique temporary path in the source directory.
5. Open and validate the temporary database with `quick_check`.
6. Report output identity and statistics to the coordinator.

The worker may create only a temporary file. It must never rename, replace, or
delete the source. Therefore an orphaned worker or coordinator crash cannot
change user data.

Use process priority and I/O priority where supported. Apply a hard runtime
limit. On timeout, terminate the worker and delete its temporary output after
confirming that it is not the source.

## Lifecycle Tracking

### Open

Before opening a non-ephemeral database, a persist worker sends `begin-open`
with the logical path, canonical physical path, owner identity, PID, and process
start token.

The coordinator:

1. Validates the path under configured roots.
2. Upserts the database row.
3. Increments `generation`.
4. Sets `last_opened_at` and `presence_state`.
5. Records the open owner.
6. Cancels or invalidates any compact build for the old generation.
7. Acknowledges the open.

The worker then opens SQLite. If SQLite open fails, it sends `open-failed` and
the coordinator removes that owner record.

The generation is incremented for every tracked open, even if the underlying
process cache already has the stream. This is conservative: any use while a
compact copy is being built invalidates that copy.

### Mutation

Do not write catalog state for every stream message. The worker keeps a
process-local dirty flag and sends a throttled mutation hint, at most once per
path every several minutes, plus a final update on close. Generation and open
ownership, rather than exact mutation time, are the promotion safety boundary.

### Final Close

Only after the underlying SQLite handle has checkpointed and closed does the
worker send `closed`. The coordinator removes the open owner and records:

- last close time;
- last mutation hint;
- current stat identity and size, if the path still exists;
- `missing` if it disappeared during close or project teardown.

This preserves the synchronous close/reopen guarantee introduced by
`0da3e3e7ae`.

### Worker Death

Open-owner rows include PID and a process start token from `/proc`, where
available, so PID reuse is distinguishable. The coordinator removes owners
when their worker IPC session closes. On startup it also removes owners whose
process identity no longer exists.

Do not expire an owner based only on elapsed time while the matching process is
still alive. A stalled event loop is still capable of resuming with an open
SQLite inode.

## Missing, Moved, Archived, And Replaced Files

Catalog paths will routinely become stale. This is expected behavior, not a
maintenance error.

### Missing File Rules

If `lstat` or open returns `ENOENT`:

1. Mark the row `presence_state='missing'` and set `missing_since`.
2. Clear candidate and retry state.
3. Cancel any build and delete only its known temporary files.
4. Do not create parent directories.
5. Do not open SQLite, since SQLite open could create a new empty database.
6. Do not copy from archive or backup.
7. Do not alert on an isolated missing file.

Rows missing for a configurable grace period, initially 30 days, can be
deleted from the catalog if they have no active run or owner. Deleting a row
does not touch the filesystem.

### Project Moves

When a project moves to another host:

- the source host eventually marks old catalog entries missing and expires
  them;
- the destination host discovers entries when they open or during its bounded
  scan;
- no catalog rows need to move between hosts;
- catalog state must never be used to infer project placement or ownership.

### Archive And Restore

If a project's filesystem is archived or unmounted, entries become missing.
Maintenance does not restore them. If the project later returns, normal project
and persist open logic remains responsible for restore behavior.

### Path Reuse And File Replacement

A path can disappear and later refer to a new database. Compare device, inode,
size, mtime, and the observed SQLite header. If identity changes after a
missing period or outside a tracked promotion:

- increment generation;
- clear old inspection and compaction statistics;
- treat it as a newly discovered database;
- retain only diagnostic timestamps from the old identity if useful.

Maintenance must revalidate identity immediately before promotion. A compact
copy built from an earlier identity is discarded.

### User Deletion Of Edit History

There are two distinct cases:

- If the user/application deletes rows within the SQLite database, the file
  remains and may become a high-value compaction candidate.
- If the user removes the SQLite file or its project tree, maintenance marks it
  missing and takes no filesystem action. The deletion itself already reclaimed
  the file's storage.

## Discovery And Reconciliation

The catalog must be populated through both normal traffic and a bounded legacy
scan.

### Traffic Discovery

Every tracked open registers its path. This quickly covers active databases
without scanning.

### Filesystem Backfill

The coordinator scans configured roots incrementally:

- bay `syncFiles.local`, account, host, and hub roots;
- project-host project-template roots and each existing project's persist
  subtree;
- configured archive roots only for inventory, never as primary compaction
  targets in the first release.

Scanner requirements:

- process a bounded number of entries and bytes per tick;
- yield between batches;
- store scan cursor and coverage timestamps;
- use `lstat` and never follow symlinks;
- accept only regular `*.db` files;
- exclude `-wal`, `-shm`, maintenance catalog, compact temporary, rollback,
  and archive-staging files;
- canonicalize and verify every candidate remains beneath an allowed root;
- tolerate directories disappearing during traversal;
- treat permission and I/O errors as per-root diagnostics, not reasons to stop
  serving streams.

A full rescan should be periodic and jittered. Catalog rows not observed in a
completed scan are rechecked directly before being marked missing.

## Candidate Selection

Start conservatively and tune from dry-run measurements.

Initial proposed requirements:

- present regular database file;
- no tracked open owner;
- all expected persist workers connected to the coordinator;
- inactive for at least 24 hours;
- not compacted within the last seven days;
- file size at least 64 MiB;
- estimated reclaimable bytes at least 32 MiB;
- estimated reclaimable ratio at least 25%;
- no current error cooldown;
- source filesystem has at least the greater of 10 GiB or 2.5 times source
  size available;
- source size below an initial maximum, such as 4 GiB, with larger databases
  requiring explicit operator review;
- host load, memory pressure, disk pressure, and I/O wait below configured
  maintenance thresholds;
- no active deploy, backup restore, project migration, or host drain conflict.

Use file size and inactivity only to shortlist. The compact worker reads exact
SQLite page statistics immediately before doing expensive work.

The scheduler should enforce:

- one active compaction per storage domain;
- a maximum number of attempts per hour;
- a maximum source-byte budget per hour and day;
- random jitter across hosts;
- exponential retry after errors;
- a minimum expected saving before promotion;
- an immediate pause when admission or disk health becomes warning or worse.

## Compaction State Machine

Suggested states:

```text
observed
  -> eligible
  -> inspecting
  -> building
  -> awaiting-promotion
  -> promoting
  -> refreshing-copies
  -> succeeded

Any pre-promotion state
  -> invalidated
  -> skipped
  -> failed
```

### Build Phase

1. Snapshot catalog generation and filesystem identity.
2. Verify no open owners and complete worker tracking coverage.
3. Verify source and temporary file paths.
4. Check disk headroom and load gates.
5. Start the low-priority compact worker.
6. Build a compact temporary database with `VACUUM INTO`.
7. Validate the temporary output.
8. If generation, presence, or source identity changed, discard the output.

An open during this phase is allowed. It increments generation and guarantees
that the result cannot be promoted.

### Promotion Phase

Promotion should be short and coordinator-owned:

1. Enter a brief per-path promotion barrier.
2. Recheck that every expected worker is connected.
3. Recheck no open owners.
4. Recheck source generation, device, inode, size, mtime, and sidecars.
5. Ensure the compact output is a regular file in the source directory.
6. Preserve source ownership, mode, and required metadata on the output.
7. Checkpoint/truncate stale WAL only through a controlled SQLite open, close
   it, and revalidate.
8. Create a same-filesystem rollback reference where supported.
9. Atomically rename the compact output over the source.
10. Fsync the new file and containing directory.
11. Run a final `quick_check` on the promoted source.
12. Remove the rollback reference only after validation.
13. Exit the promotion barrier.

If the barrier exceeds a small bound, initially two seconds, abort promotion
and keep the source. The expensive compact copy may be retried or discarded,
but clients should not wait behind a long maintenance operation.

### Archive And Backup Refresh

After primary promotion, refresh configured archive and backup destinations
using a consistent SQLite backup or a validated immutable staging copy. Do not
raw-copy a live WAL database.

Archive refresh should use destination temporary files followed by atomic
replacement where supported. A refresh failure is a partial maintenance
failure:

- the compact primary remains valid;
- record and retry archive/backup refresh;
- ensure normal open logic prefers the newer primary rather than restoring the
  older archive;
- do not reverse a successful primary compaction solely because an optional
  backup copy failed.

This part must be tested against the actual archive filesystem semantics used
in production.

## Catalog Failure Semantics

The catalog is disposable state. On corruption or loss:

1. Disable candidate selection and promotion.
2. Stop or invalidate active compact builds.
3. Continue normal persist serving without catalog tracking.
4. Move the broken catalog aside for diagnostics.
5. Create a fresh catalog.
6. Re-register live workers and open paths.
7. Run a bounded filesystem rebuild.
8. Require a complete safe warmup before re-enabling promotion.

The catalog should never be restored over current user data and should not be
required for backup restoration.

## Configuration

All mutation should initially be disabled by default.

Suggested settings:

```text
COCALC_PERSIST_MAINTENANCE_ENABLED=0
COCALC_PERSIST_MAINTENANCE_DRY_RUN=1
COCALC_PERSIST_MAINTENANCE_DB=
COCALC_PERSIST_MAINTENANCE_IDLE_HOURS=24
COCALC_PERSIST_MAINTENANCE_MIN_FILE_MB=64
COCALC_PERSIST_MAINTENANCE_MIN_RECLAIM_MB=32
COCALC_PERSIST_MAINTENANCE_MIN_RECLAIM_RATIO=0.25
COCALC_PERSIST_MAINTENANCE_MIN_DAYS_BETWEEN=7
COCALC_PERSIST_MAINTENANCE_MAX_FILE_GB=4
COCALC_PERSIST_MAINTENANCE_MAX_BYTES_PER_HOUR=1073741824
COCALC_PERSIST_MAINTENANCE_MAX_CONCURRENT=1
COCALC_PERSIST_MAINTENANCE_MISSING_RETENTION_DAYS=30
COCALC_PERSIST_MAINTENANCE_JOB_TIMEOUT_MINUTES=30
```

Site settings or host metadata can later override these, but the first release
should prefer environment configuration with explicit deployment control.

## Observability

Expose a read-only maintenance status from both project-host and bay persist:

- catalog enabled and healthy;
- mutation enabled or dry-run;
- registered and expected workers;
- currently open paths;
- known present, missing, and unverified databases;
- scan roots, coverage, cursor, and last completed scan;
- eligible candidates and estimated reclaimable bytes;
- active run, source size, elapsed time, and phase;
- attempts, successes, invalidations, timeouts, and failures;
- bytes inspected and reclaimed over 1 hour, 24 hours, and lifetime;
- archive/backup refresh backlog;
- oldest missing row and catalog size;
- scheduler pause reason.

Record structured logs for state transitions, but avoid one log or database row
per scanned file on every pass.

Routine candidates, missing files, generation invalidations, and successful
compactions are monitoring state, not pages. Alert only for conditions that
need action, such as:

- repeated catalog corruption;
- repeated integrity-check failures;
- maintenance temporary files causing disk pressure;
- a stuck promotion barrier;
- repeated archive refresh failures that reduce recovery safety;
- compaction unexpectedly blocking persist latency;
- scheduler running despite an explicit disable setting.

## Testing Plan

### Unit Tests

- catalog schema creation and migration;
- path hashing and canonical root validation;
- symlink and traversal rejection;
- candidate threshold calculations;
- missing-row state transitions and expiry;
- path disappearance during every state;
- path reappearance with same and different inode identity;
- project move represented as source missing and destination discovery;
- generation invalidation on open;
- stale owner cleanup using PID plus process start token;
- dry-run never starts a worker;
- run-history pruning and catalog incremental vacuum;
- disk and load gate calculations;
- bounded scan cursor behavior.

### SQLite Integration Tests

- create a large database, delete most messages, and verify expected free-page
  measurement;
- build with `VACUUM INTO` and verify content, metadata, checkpoints, and
  configuration are unchanged;
- verify the compact output is smaller;
- open or mutate the source during build and verify output is discarded;
- remove the source during build and verify no source is recreated;
- replace the source inode during build and verify promotion is rejected;
- kill the compact worker and verify source remains valid;
- kill the coordinator after build and verify source remains valid;
- simulate disk full while creating the output;
- simulate corrupt source and corrupt output;
- verify rollback after failed post-promotion validation;
- verify WAL and SHM sidecars are handled safely;
- verify source permissions and ownership survive promotion;
- verify archive and backup copies remain usable.

### Multi-Process Tests

- two bay persist workers using the same catalog and filesystem;
- a worker opens a path immediately before promotion;
- worker disconnect disables promotion coverage;
- worker crashes with an open-owner row;
- PID reuse does not clear another process's owner;
- persist worker count changes across restart;
- coordinator unavailable causes workers to serve while no promotion occurs;
- load-balancer reassignment cannot result in replacement of an open inode.

### Project Lifecycle Tests

- move a stopped project to another host;
- archive and unarchive a project;
- delete a project filesystem while catalog rows exist;
- delete edit history inside a database and reclaim space later;
- delete the SQLite file itself and confirm maintenance leaves it absent;
- restore a project whose path was previously marked missing;
- delete and recreate a logical stream at the same path.

### Performance Tests

- measure catalog registration latency at realistic open bursts;
- verify scanning does not materially affect project start or file-open latency;
- run compaction under synthetic host load and monitor iowait;
- confirm persist event-loop delay remains flat during compact-copy work;
- measure source, temporary, archive, and backup peak disk requirements;
- measure backup-size reduction after compaction.

## Implementation Phases

### Phase 0: Measurement Utilities

- Add reusable path identity and SQLite page-stat helpers.
- Add a read-only command that inspects one explicitly selected closed database.
- Verify `VACUUM INTO`, permission preservation, and archive behavior on staging
  filesystems.
- No automatic scanning or mutation.

Exit criteria:

- page and reclaim estimates match actual compacted sizes closely enough for
  scheduling;
- source remains valid through worker termination and disk-full tests.

### Phase 1: Catalog And Traffic Tracking

- Create the catalog module and schema.
- Register coordinator and worker process identities.
- Track opens, final closes, and throttled mutations.
- Add status and metrics.
- Keep maintenance disabled.

Exit criteria:

- tracking adds negligible latency;
- catalog loss or coordinator outage does not affect stream availability;
- open-owner state is correct across worker restarts.

### Phase 2: Bounded Discovery And Dry Run

- Add project-host and bay root scanners.
- Add missing, moved, and replaced-file reconciliation.
- Compute dry-run candidates and estimated savings.
- Deploy with mutation disabled.

Exit criteria:

- scans complete without load spikes;
- no paths outside approved roots appear;
- missing project paths generate no alerts or recreation;
- observed size/reclaim distributions support final threshold selection.

### Phase 3: Compact Build Without Promotion

- Run low-priority `VACUUM INTO` workers for selected staging candidates.
- Always validate and discard output.
- Exercise cancellation, generation invalidation, and crash recovery.

Exit criteria:

- builds do not block persist workers;
- no source file changes;
- temporary cleanup is reliable;
- estimates and output sizes agree.

### Phase 4: Staging Promotion

- Enable atomic promotion on staging.
- Test project-host and bay topologies separately.
- Run the full lifecycle and failure test matrix.
- Verify archive, backup, restart, and restore behavior.

Exit criteria:

- no user-visible persist latency regression;
- every promoted database passes integrity and semantic content checks;
- all injected races safely abort or recover;
- restart with abandoned temp and rollback files is deterministic.

### Phase 5: Production Canary

- Deploy tracking and dry-run everywhere first.
- Enable mutation on one low-risk project host with stricter thresholds, for
  example 256 MiB minimum file, 50% reclaim ratio, and one job per day.
- Observe for at least 48 hours.
- Enable one bay canary only after project-host results are clean.
- Compare disk, backup bytes, iowait, persist latency, and support signals.

Exit criteria:

- reclaimed bytes are material;
- no integrity, latency, or archive regressions;
- no unexpected project starts or file opens wait on maintenance.

### Phase 6: Gradual Fleet Rollout

- Expand to a small host cohort.
- Add regional jitter and byte budgets.
- Expand project-host coverage before bay coverage.
- Relax thresholds only from measured evidence.
- Keep an immediate global disable switch.

## Deployment Procedure

For each phase:

1. Build and run focused Conat, backend, server, and project-host tests.
2. Deploy to staging with maintenance mutation disabled.
3. Verify catalog health, worker registration, and scan bounds.
4. Run explicit lifecycle and failure probes.
5. Enable the phase-specific staging feature flag.
6. Observe latency, iowait, disk, logs, and integrity checks.
7. Deploy inert code to production.
8. Confirm production dry-run state before enabling any canary.
9. Enable one bounded canary.
10. Record before/after source size, output size, duration, and backup effects.
11. Expand only after the observation window passes.

Do not combine first production mutation with a Conat persist binary rollout,
host restart campaign, storage migration, or project-bundle deployment.

## Rollback

The primary rollback is configuration-only:

```text
COCALC_PERSIST_MAINTENANCE_ENABLED=0
```

On disable:

- stop selecting candidates;
- terminate compact workers;
- discard known temporary outputs;
- never interrupt normal persist serving;
- allow an already-entered atomic promotion section to finish or roll back
  deterministically;
- retain the catalog for diagnostics and later reuse.

If the coordinator code itself is suspect, stop it and run persist without
tracking. Since compact workers cannot promote, orphaned compact output is
safe to remove after path validation.

Rollback must never restore every `.rollback` or archive file blindly. Recovery
uses run records, file identities, and integrity checks for the exact path.

## Acceptance Criteria

The feature is ready for broad production use only when:

1. Persist remains available with the coordinator stopped or catalog removed.
2. Missing and moved project files are never recreated by maintenance.
3. A source open at any point before promotion invalidates the compact copy.
4. Coordinator and worker crashes leave the source valid.
5. Peak temporary storage is measured and bounded.
6. Persist event-loop and user-visible file-open latency do not regress.
7. Archive and backup refresh behavior is proven on production-equivalent
   filesystems.
8. Dry-run measurements show material expected savings.
9. Operators can see scan coverage, candidates, active work, bytes reclaimed,
   errors, and pause reasons.
10. A global disable takes effect without restarting projects.

## Recommended First Implementation Slice

The first code change should implement only:

- catalog schema and migrations;
- coordinator lifecycle;
- worker registration;
- first-open/final-close tracking;
- missing and replaced path states;
- read-only status;
- no filesystem scanner;
- no compact worker;
- no promotion.

This establishes the safety and observability foundation without touching user
databases. The second slice adds bounded discovery and dry-run candidate
measurement. Mutation should begin only after those two slices have run long
enough to show how the real project-host and bay populations behave.
