# Conat Persist SQLite Maintenance Implementation

Date: 2026-07-17

Status: implemented and validated on staging; production review pending

This document records the implementation of
`conat-persist-sqlite-maintenance-plan-2026-07-17.md` and the procedure for
validating it before production. The feature is disabled by default. Deploying
the code alone cannot compact a database.

## Implemented Architecture

Both project-host persist and bay persist use the same backend maintenance
coordinator. The generic Conat storage package only exposes lifecycle hooks and
portable policy types.

- Every persistent SQLite open is registered before the ref-counted stream is
  acquired. Failed opens remove their provisional owner.
- Every successful mutation advances a throttled mutation hint.
- An owner is removed only after the last process-local reference closes, the
  WAL is checkpointed, the SQLite handle is closed, and normal backup work has
  completed.
- A rebuildable local `catalog.sqlite` stores file identity, generation,
  owners, observed use, page statistics, run history, scan cursors, budgets,
  and secondary-copy retry state.
- A bounded filesystem scanner discovers databases that have not opened since
  maintenance was installed. Missing files are marked missing and eventually
  forgotten; maintenance never recreates them.
- A low-priority child Node process performs read-only inspection and
  `VACUUM INTO`. It has a hard timeout and cannot promote its output.
- The coordinator promotes only after revalidating path safety, complete
  worker tracking, generation, open-owner count, source identity, load,
  memory, disk headroom, and rate budgets.
- Promotion uses a same-directory rollback hard link or rename and an atomic
  rename. The exact replacement inode is quick-checked in the child
  immediately before promotion. A second synchronous multi-gigabyte check is
  deliberately not run inside the persist process because it would stall the
  data plane.
- Archive and backup refreshes happen asynchronously after primary promotion.
  Failures are persisted and retried; they cannot invalidate a valid primary.
- Startup recovery handles interrupted outputs, rollback files, promoted
  primaries, and staged secondary copies. A corrupt catalog is moved aside and
  rebuilt from normal opens and scans.
- Multi-worker bay persist uses acknowledged IPC. Any missing or unhealthy
  worker blocks promotion but does not block normal persistence.

The primary implementation is under:

```text
packages/conat/persist/maintenance/
packages/backend/conat/persist-maintenance/
```

Integration points are `packages/project-host/conat-persist.ts` and
`packages/server/conat/persist/`.

## Operational Status

Standalone project-host and current standalone bay persist daemons expose a
loopback-only `GET /maintenancez` response. It reports:

- enabled and dry-run state;
- catalog health and path;
- expected and registered workers plus tracking coverage;
- present, missing, open, eligible, and inspected database counts;
- estimated reclaimable and actually reclaimed bytes;
- scan timestamps and progress;
- the active run and current pause reason;
- successful, failed, skipped, and dry-run run counts;
- pending archive/backup refresh work and the last error.

The catalog remains directly inspectable with SQLite. Operators can inspect an
individual database without changing it using:

```sh
node dist/conat/persist-maintenance/inspect.js /absolute/path/to/file.db
```

## Configuration

The global kill switches are:

```text
COCALC_PERSIST_MAINTENANCE_ENABLED=0
COCALC_PERSIST_MAINTENANCE_DRY_RUN=1
```

Those are the code defaults. Mutation requires both `ENABLED=1` and
`DRY_RUN=0`. Creating the configured pause file also stops candidate work.

The conservative production-shaped defaults are:

```text
COCALC_PERSIST_MAINTENANCE_IDLE_HOURS=24
COCALC_PERSIST_MAINTENANCE_MIN_FILE_MB=64
COCALC_PERSIST_MAINTENANCE_MIN_RECLAIM_MB=32
COCALC_PERSIST_MAINTENANCE_MIN_RECLAIM_RATIO=0.25
COCALC_PERSIST_MAINTENANCE_MIN_DAYS_BETWEEN=7
COCALC_PERSIST_MAINTENANCE_MAX_FILE_GB=4
COCALC_PERSIST_MAINTENANCE_MAX_BYTES_PER_HOUR=1073741824
COCALC_PERSIST_MAINTENANCE_MAX_BYTES_PER_DAY=4294967296
COCALC_PERSIST_MAINTENANCE_MAX_ATTEMPTS_PER_HOUR=4
COCALC_PERSIST_MAINTENANCE_MAX_CONCURRENT=1
COCALC_PERSIST_MAINTENANCE_JOB_TIMEOUT_MINUTES=30
COCALC_PERSIST_MAINTENANCE_MIN_FREE_GB=10
COCALC_PERSIST_MAINTENANCE_FREE_SPACE_MULTIPLIER=2.5
COCALC_PERSIST_MAINTENANCE_MAX_LOAD_PER_CPU=0.75
COCALC_PERSIST_MAINTENANCE_MIN_FREE_MEMORY_RATIO=0.10
```

Scan, scheduler, retention, promotion-barrier, mutation-hint, catalog-path,
and pause-file settings are also configurable with the corresponding names in
`packages/backend/conat/persist-maintenance/config.ts`.

## Staging Deployment And Validation

1. Build one immutable bay artifact and one immutable project-host artifact
   from the reviewed commit.
2. Deploy only `bay-conat-persist` from the bay artifact and
   `host-conat-persist` from the project-host artifact to staging.
3. Initially set `ENABLED=1`, `DRY_RUN=1` on both topologies. Confirm service
   readiness, complete owner tracking, catalog creation, bounded scan progress,
   and candidate/run accounting without source inode or size changes.
4. Create a disposable staging stream database containing verifiable rows,
   grow it, delete most rows, and close its final client. Do not use a user
   database for the mutation test.
5. On one staging topology at a time, use thresholds that select only that
   large disposable database, set `DRY_RUN=0`, and restart only its persist
   service.
6. Verify a successful run, smaller source size, changed inode, `quick_check`
   success, intact expected rows, no lingering compact/rollback files, correct
   reclaimed-byte accounting, and refreshed archive/backup data where
   configured.
7. Open the disposable database while a compact child is running. Verify the
   generation/owner barrier discards the output and leaves the source inode
   unchanged. The deterministic version of this race is also covered by unit
   tests.
8. Interrupt a disposable run after rollback creation and restart the
   coordinator. Verify startup recovery preserves a quick-checkable primary
   and closes the unfinished run. Do not perform this crash test on a process
   serving non-disposable staging data unless it has first been isolated.
9. Confirm ordinary Conat stream latency and service readiness remain normal
   during inspection, compaction, and secondary-copy refresh.
10. Return staging to conservative defaults after the accelerated test. Leave
    production disabled until code and staging evidence are reviewed.

## Rollback

The immediate operational rollback is to set
`COCALC_PERSIST_MAINTENANCE_ENABLED=0` or create the pause file, then restart
the relevant persist service. Normal Conat persistence does not depend on the
catalog or coordinator.

If the catalog itself is suspect, stop the service, preserve
`.maintenance/catalog.sqlite*` for diagnosis, and move it aside. Startup
creates a new catalog and bounded scans repopulate it. Never copy catalog data
back into project databases.

An interrupted primary promotion is recovered from its same-directory rollback
artifact. Finished compact outputs are disposable. Pending archive/backup
refresh entries are advisory retry work and may be discarded if operators
prefer the normal backup path to reconstruct them.

## Validation Before Staging

The implementation has passed the full backend Conat persist suite: 15 test
suites and 92 tests. Focused maintenance and close-lifecycle validation covers
candidate policy, ref-counted ownership, scanner bounds, missing and replaced
files, symlink rejection, actual `VACUUM INTO`, promotion, open-during-build
invalidation, rollback, secondary refresh retry, corrupt-catalog rebuild,
interrupted-run recovery, stale-process owners, dry-run behavior, and
multi-worker coverage. Backend, Conat, project-host, and server package
typechecks pass.

## Staging Validation Results

Commit `0e635ccd2ad233e2f3361b7b5d3ae8caa421d5f2` was deployed to staging on
2026-07-17 using these immutable artifacts:

```text
bay:          20260717T190419Z-0e635ccd-persist-maintenance-20260717
project-host: 20260717T190736Z-0e635ccd-persist-maintenance-20260717
```

Only `bay-conat-persist` and the managed project-host `conat-persist`
components were restarted. No production component was deployed or enabled.

Dry-run inventory completed with healthy catalogs, complete worker coverage,
and no failures:

```text
staging bay:   102 existing databases
staging host:  422 existing databases
staging host2: 140 existing databases
```

Every existing database was below the accelerated 1 MB staging threshold. A
disposable 34,086,912-byte SQLite database was therefore created in the bay
storage domain and another on `host`. Each contained 1,024 initial 32 KiB rows,
then retained only 8 rows, leaving 8,254 of 8,322 pages free. Dry-run inspection
identified each as the only eligible candidate and estimated 33,808,384 bytes
reclaimable without changing its source inode or size.

Real maintenance was then enabled on one domain at a time. Both promotions
completed successfully:

```text
before size:       34,086,912 bytes
after size:           270,336 bytes
reclaimed:         33,816,576 bytes
bay duration:             179 ms
host duration:             56 ms
```

For both results, the inode changed, ownership and mode were preserved, the 8
expected rows and 262,144 live payload bytes remained, `PRAGMA quick_check`
returned `ok`, the freelist became zero, and no compact or rollback artifact
remained. The catalog recorded one success and no failure, timeout,
invalidation, or secondary-refresh backlog.

Both disposable directories were then deleted. The next bounded scan marked
their catalog rows `missing` and did not recreate either path.

The staging bay and both staging project-host persist services were finally
restarted with maintenance enabled, mutation enabled, and all accelerated
threshold/interval overrides removed. They now use the conservative defaults
documented above. All three loopback health and maintenance endpoints are
ready, catalogs remain healthy, tracking coverage is complete, and recent logs
contain no maintenance error. The full bay smoke test passed homepage, static,
favicon, and all four worker-to-host route checks. The project-host smoke test
confirmed the representative host artifact, deployment status, and host RPC.
The CLI does not yet implement component-specific smoke commands for
`bay-conat-persist` or `host-conat-persist`, so direct health/status checks and
the parent artifact smoke tests were used instead.

## Remaining Production Gate

Production must not be enabled merely because staging compaction succeeds.
The review should also confirm measured candidate volume, reclaim estimates,
runtime duration, I/O impact, event-loop latency, scan duration, catalog size,
and secondary-refresh backlog on staging. Initial production rollout should be
dry-run first, then one canary storage domain, then a small fleet fraction,
with a pause between each phase.
