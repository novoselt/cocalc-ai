# Disposable Bay Restore Drill Implementation

Date: 2026-07-19

## Objective

Prove that the latest remote full bay backup is independently recoverable
without using the production bay's disk, PostgreSQL server, Conat server,
container runtime, or network path. The first implementation validates the
PostgreSQL checkpoint captured by `pg_basebackup` and the authoritative Conat
SQLite databases. It deliberately does not start a replacement bay or accept
user traffic.

Continuous WAL archiving is currently disabled because its retained data volume
was unexpectedly large. This drill therefore does not claim point-in-time
recovery. Its recovery-point objective is the latest successful full snapshot,
and potential data loss is bounded by the full-snapshot schedule. PITR storage,
retention, and cost need a separate design review before being re-enabled.

## Operator Interface

Run the drill through the authoritative bay:

```sh
cocalc bay restore-test <bay-id> --disposable-gcp
```

The RPC requires an administrator account and fresh session authorization. The
existing bay-local and `--remote-only` modes remain available, but the admin UI
now recommends the disposable mode.

## Isolation Model

The bay creates a direct GCP instance rather than a CoCalc project host. The
worker therefore has no project-host database row, no Conat registration, no
Cloudflare tunnel, and no route for user traffic.

The worker has:

- no attached GCP service account;
- project SSH keys blocked and OS Login disabled;
- no listening application service;
- unsolicited IPv4 and IPv6 ingress dropped at startup;
- Secure Boot, vTPM, and integrity monitoring enabled;
- one auto-delete balanced persistent boot disk;
- a maximum run duration with GCP `DELETE` as the termination action;
- a deterministic, run-scoped instance name that the bay deletes in every
  success and failure path.

The cleanup path takes ownership of the deterministic name before the GCP
insert request. This matters when GCP accepts an instance but the API response
times out. The bay still attempts deletion by name, while maximum-duration
deletion remains the final orphan safeguard.

## R2 Credential Model

The worker never receives the bay's durable R2 access secret or Cloudflare API
token. The bay asks Cloudflare's R2 Temporary Credentials API for a short-lived
session with `object-read-only` permission. Its scope is limited to the regional
rustic repository used by the selected snapshot. Snapshot-only drills do not
grant the worker access to the WAL archive prefix.

The lifetime is the configured drill timeout plus 30 minutes, capped at seven
days. The startup script contains only these temporary credentials and the
rustic repository password. It is installed in root-only files and disappears
with the VM and boot disk.

## Capacity Preflight

Before creating the VM, the bay obtains the live PostgreSQL database size and
the selected backup artifact size. The requested boot disk reserves space for:

- 1.5 times the uncompressed PostgreSQL database size;
- twice the larger of the backup artifact size or 1 GiB;
- 20 GiB for Ubuntu, package installation, the PostgreSQL image, WAL replay,
  and transient files;
- 30% additional filesystem headroom.

The disk is bounded to 50-2048 GiB. The worker repeats the free-space check
before downloading a snapshot and fails without restoring if the disk does not
meet the computed requirement.

## PostgreSQL Validation

The worker restores the selected rustic snapshot once, installs the bundled
`pg_wal` files produced by `pg_basebackup -X stream`, and starts the matching
PostgreSQL major version in an unexposed Podman container. It explicitly
disables archival in the disposable database.

The drill passes only when PostgreSQL accepts queries, is not in recovery, and
the `accounts`, `projects`, and `server_settings` tables exist. This proves that
the remote base backup is a bootable database at its captured checkpoint. The
result explicitly records `pitr_verified=false` and does not update PITR test
state.

## Conat Validation

The same restored rustic snapshot contains the bay Conat persist tree. Every
authoritative `*.db` file under the restored `sync` tree is opened read-only and
must pass `PRAGMA quick_check`. The result records the number of databases,
total bytes, and number passing the check. A missing sync tree or zero database
files is a hard failure.

`.maintenance/catalog.sqlite` is checked separately when present, but a failed
catalog check is reported without failing the drill because the maintenance
catalog is derived and rebuildable. The authoritative SQLite databases are the
recovery requirement.

## Result and Audit Evidence

The worker writes one nonce-bound, size-bounded JSON result to the serial
console. The bay accepts only its own nonce and run ID, validates the invariants
again, deletes the VM, and then persists evidence in bay backup readiness state:

- execution mode, restore mode, duration, stage, and bounded failure text;
- worker project, zone, machine type, disk size, and cleanup result;
- Conat database count, byte count, and quick-check count.

The admin bay operations view displays the latest evidence. A drill failure is
also persisted and never marks recovery readiness as newly successful.

## Validation Before Staging

Commit `1c78ac8f268c398149e0807e7e943792b05f81d4` passed:

- 20 focused server restore and disposable-worker tests;
- all 515 CLI tests;
- server and Conat TypeScript builds with an 8 GiB Node heap;
- full backend lint and frontend lint.

The tests include temporary credential scope, startup-script syntax and metadata
size, secret non-disclosure, serial-result parsing, cleanup after success,
cleanup after worker failure, and cleanup after an ambiguous instance insertion
failure.

## Staging Evidence

Pending the first real staging deployment and disposable worker run.

## Production Gate

Production deployment remains blocked until the staging drill has:

1. restored PostgreSQL from R2 and started it at the captured checkpoint;
2. checked every restored authoritative Conat SQLite database;
3. reported successful worker deletion;
4. left no restore worker instance or disk behind; and
5. exposed the persisted evidence through the staging backup-readiness API.

Future iterations can install and start a complete isolated bay clone and run
application smoke tests. A separate follow-up must design cost-bounded WAL
retention, likely with explicit lifecycle and recovery-point targets, before
PITR testing is enabled again. Both are intentionally outside this first
change.
