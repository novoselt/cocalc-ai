# Bay Backup Storage Reliability Plan

Date: 2026-08-01

Status: implemented, validated on staging, and deployed to production. Daily
production full snapshots are enabled on primary worker 1.

## Goal

Make bay backups unable to exhaust the PostgreSQL filesystem, eliminate the
multi-worker full-backup retry herd, and retain useful local recovery points
without paying for long-term backup retention on the database SSD.

The durable backup remains the regional Rustic repository plus R2 WAL. Local
snapshots are a short recovery cache, not the long-term backup archive.

## Incident Summary

Production stored PostgreSQL and bay backups on the same 500 GiB `pd-ssd`.
Four hub workers independently ran the automatic full-snapshot scheduler. A
PostgreSQL advisory lock prevented concurrent snapshots, but after a failed run
released the lock another overdue worker immediately started. This converted a
concurrent herd into a serial herd.

The July 31 backup was the last committed snapshot. Three later runs produced
about 61 GiB of failed-but-retained local archives. Approximately 45 GiB of old
staging directories and a 55 GiB Rustic materialization workspace were also
present. Retention ran only after final manifest commit, so none of those failed
runs reclaimed older data. The shared filesystem reached zero free bytes,
PostgreSQL failed writes, and every hub worker became unavailable through its
PostgreSQL dependency.

## Required Invariants

1. **Backup isolation:** a production full snapshot, Rustic workspace, restore
   workspace, or failed backup must never consume the PostgreSQL filesystem.
2. **Fail closed:** if the configured backup volume is absent or is not a
   separate filesystem, backup work fails before creating files. The bay and
   PostgreSQL remain available.
3. **One scheduler:** only the primary bay worker schedules automatic full
   snapshots and WAL synchronization. Manual backup RPCs retain the
   cross-process PostgreSQL advisory lock.
4. **Space admission:** a full snapshot starts only when the backup filesystem
   has the configured reserve plus a conservative estimate of archive and
   Rustic workspace growth.
5. **Bounded failure:** a failed run removes its uncommitted staging and archive
   data. Startup reconciliation removes abandoned work from dead processes.
6. **Bounded retention:** production keeps two committed local full snapshots.
   Historical retention belongs in Rustic/R2 and GCP disk snapshots.
7. **Observable state:** status reports the scheduler owner, filesystem,
   capacity, admission estimate, cleanup result, and the reason a run was
   refused.

## Storage Layout

Provision one 500 GiB zonal `pd-balanced` volume per bay and mount it at:

```text
/mnt/cocalc-backups
```

Set:

```text
COCALC_BACKUP_ROOT=/mnt/cocalc-backups
COCALC_BAY_BACKUP_REQUIRE_SEPARATE_FILESYSTEM=1
COCALC_BAY_BACKUP_RETENTION_COUNT=2
```

The mount is `nofail` so a missing backup disk does not prevent the bay from
booting. Application-level validation makes backup operations fail closed
instead of silently writing through the empty mountpoint onto the data disk.

At current production size, one snapshot has about 21 GiB of compressed
artifacts and its Rustic materialization has reached about 55 GiB. A 500 GiB
balanced disk leaves room for two committed snapshots, one in-flight archive,
one Rustic workspace, restore testing, growth, and a substantial reserve.

This does not reduce the existing 500 GiB `pd-ssd` charge because Persistent
Disks cannot be shrunk or converted in place. Keep that volume unchanged for
PostgreSQL capacity and IOPS headroom; database right-sizing is explicitly not
part of this reliability rollout.

## Implementation

### 1. Scheduler Ownership

- Start full-snapshot and WAL maintenance only on primary bay worker 1.
- Log explicit skip messages on other workers.
- Keep `runBayBackup()` callable from every worker.
- Keep the PostgreSQL advisory lock as defense in depth for manual calls and
  accidental scheduler duplication.
- Add tests proving four worker initializations result in one scheduler owner.

### 2. Backup-Volume Contract

- Add a strict separate-filesystem check before directory creation or state
  writes when `COCALC_BAY_BACKUP_REQUIRE_SEPARATE_FILESYSTEM=1`.
- Require the configured backup root to exist, be a directory, and have a
  different device identity from its parent mount.
- Surface the root, device identity, total/free bytes, and validation status in
  bay backup status.
- Add the backup-root and strict-mode settings to the bay systemd environment
  template and deployment documentation.

### 3. Admission And Cleanup

- Read free bytes using `statfs` while holding the bay backup run lock.
- Reserve at least 64 GiB after the run, configurable by environment.
- Estimate transient demand conservatively from the latest artifact size,
  including the compressed archive and Rustic materialization. Permit an
  explicit override for staging and unusual databases.
- Before admission, remove stale staging and manifest temporary files older
  than the configured age while holding the backup lock.
- Remove uncommitted archive data when a run fails after staging is renamed.
- Reconcile abandoned uncommitted archives from dead runs, retaining at most
  one recent orphan only when an operator explicitly enables forensic
  retention.
- Apply local retention before and after a run so an old committed snapshot is
  removed before allocating the next workspace when safe.

### 4. Retry Behavior

- A capacity or mount-contract failure records one maintenance failure and does
  not create staging data.
- Automatic retries remain owned by worker 1 and use bounded exponential
  backoff rather than an unconditional 15-minute cadence.
- A remote upload failure commits the usable local snapshot and records it as
  local-only; a later operation uploads that existing archive rather than
  running `pg_basebackup` again.

## Staging Validation

1. Attach and mount a 500 GiB `pd-balanced` backup disk on the staging bay.
2. Deploy the code with the automatic scheduler disabled.
3. Migrate the staging backup state and configure the strict backup root.
4. Restart all hub workers and prove only worker 1 owns automatic maintenance.
5. Run a successful manual backup and remote-only restore verification.
6. Restart all workers while a backup is due and prove only one
   `pg_basebackup` starts.
7. Inject Rustic upload failure and prove no second full snapshot starts and no
   uncommitted archive accumulates.
8. Fill the backup disk to the admission threshold and prove the backup is
   refused while PostgreSQL and public hub health remain normal.
9. Unmount the backup disk and prove backup operations fail closed without
   creating `/mnt/cocalc-backups/bay-backups` on the data disk.
10. Kill a backup process, remount/restart, and prove stale workspace cleanup is
    bounded and safe.

## Production Migration

Automatic full snapshots remain disabled throughout migration.

1. Create and attach `prod-bay-0-backups`, a 500 GiB zonal `pd-balanced` disk in
   the production bay zone.
2. Format it as ext4, mount it at `/mnt/cocalc-backups`, persist the UUID in
   `/etc/fstab`, and set ownership for `cocalc-bay`.
3. Copy backup state, events, manifests, WAL, and the two newest committed local
   archives. Do not copy staging directories or uncommitted August archives.
4. Configure the explicit backup root, strict separate-filesystem requirement,
   two-snapshot retention, and the free-space reserve.
5. Roll hub workers individually. Verify four healthy workers, one scheduler
   owner, the new filesystem identity, and no backup process.
6. Run one manual full backup. Verify local manifest commit, Rustic snapshot,
   remote-only restore metadata, WAL synchronization, retention, and disk
   headroom.
7. Re-enable the 24-hour scheduler and roll workers individually.
8. Observe health after the scheduler roll. Once restore evidence is sound,
   delete the old backup repository from the PostgreSQL disk and verify the
   reclaimed PostgreSQL-disk headroom.

The old repository remains untouched until the first backup and restore checks
on the new volume pass, making rollback an environment change and worker roll.

## Acceptance Criteria

- Four workers cannot produce more than one automatic full snapshot.
- Missing or full backup storage cannot reduce PostgreSQL free space.
- A failed snapshot returns the backup filesystem to its pre-run committed
  footprint, apart from explicitly bounded forensic data.
- At most two committed local archives remain after success.
- Production backup status reports a validated separate filesystem and at
  least the configured reserve.
- A remote-only restore test passes for a snapshot created after migration.
- PostgreSQL, router, persist, and public hub health remain available during
  every injected backup failure.

## Completion Evidence

Staging used a separate 500 GiB `pd-balanced` disk and passed successful backup
and remote restore, missing-mount fail-closed, capacity refusal, four-worker
scheduler convergence, killed-backup cleanup, and bounded retry tests. Hub
health remained normal through every injected failure.

Production completed the migration on 2026-08-02 UTC:

- `prod-bay-0-backups` is mounted at `/mnt/cocalc-backups` on a filesystem
  distinct from `/mnt/cocalc`.
- Backup set `e52d24d9-8dcf-43ab-9a64-7a295e5d0a31` committed 21.6 GB of
  local artifacts and Rustic snapshot
  `7c9f851853c0f310b33b30344ecbec8b1c2ae1eb09f05fd8f2bafdd6fbca694d`.
- A remote-only restore of that exact Rustic snapshot started as an isolated
  PostgreSQL cluster, passed schema dump, had zero invalid indexes, and restored
  all 66,397 Conat SQLite databases with successful `PRAGMA quick_check`.
- All four hub workers remained healthy during backup, remote restore, and the
  rolling scheduler activation.
- The retired 273 GiB repository was deleted from the PostgreSQL disk only
  after remote restore validation. Free space on that disk increased from
  99 GiB to 371 GiB.
- Production keeps two local committed snapshots, requires 64 GiB free after
  admission, and schedules snapshots every 24 hours only on worker 1.

Two follow-ups are intentionally separate from this incident mitigation:

- Long `bay backup` and `bay restore` RPCs require CLI timeout values that
  exceed the work duration; the default operator timeout can expire while the
  server-side operation continues safely.
- Startup WAL-state publication can overwrite the persisted
  `maintenance_next_run_at` field with `null`. The primary worker's in-memory
  timer remains active and restart scheduling is recomputed from the last
  successful backup, but state-file updates should be serialized for accurate
  status. PostgreSQL WAL archiving also remains disabled, so this rollout
  validates full-snapshot recovery rather than PITR.

## Explicit Non-Goal

Do not resize or migrate the existing 500 GiB PostgreSQL `pd-ssd` as part of
this work. Its unused capacity provides database growth and IOPS headroom. Any
future database-disk cost optimization requires independent measurements,
review, and a separate maintenance plan.
