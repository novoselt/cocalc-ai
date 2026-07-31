# Project-Host Storage Scalability Staging Results

Date: 2026-07-30

Status: implemented and qualified on staging; production unchanged

Related plan:

- `src/.agents/project-host-quota-startup-scalability-plan-2026-07-30.md`

## Scope

This qualification covers the storage-startup scalability work that followed
the quota queue and desired/applied ledger implementation:

- durable filesystem quota epochs;
- durable Btrfs volume identities;
- bounded managed-volume inventory;
- removal of recurring full subvolume inventory from project-host startup;
- removal of remaining normal-path loops over all hosted projects;
- project lifecycle behavior with 10,000 dormant projects and subvolumes;
- low-disruption project-host restart behavior; and
- exact, reversible staging corpus cleanup.

No production API, host, database, DNS, or storage resource was touched.

## Implementation

The implementation is in:

```text
98ec785257 project-host/storage: make volume state durable and bounded
f7dce9527f project-host/storage: make staging cleanup exact
```

The durable state records:

- filesystem UUID, active quota mode, and monotonic quota epoch;
- project ID and volume kind;
- mountpoint and relative path;
- Btrfs subvolume UUID, subvolume ID, and generation;
- desired and applied quota revision and bytes;
- applied filesystem epoch and volume identity; and
- inventory bootstrap and bounded-verification cursors.

An applied quota claim is valid only when desired bytes, desired revision,
filesystem epoch, and current volume identity all match.

The legacy full Btrfs inventory runs once per filesystem UUID, after the host
has already become ready. Normal operation records volume creation,
replacement, restore, scratch reset, and deletion incrementally. A persisted
cursor verifies 32 known volumes per five-minute interval with targeted
`btrfs subvolume show` calls.

Normal startup and recurring status work now query:

- a keyed project row;
- indexed active-project subsets;
- SQL aggregate state counts;
- a bounded quota-repair batch; and
- a bounded managed-volume verification batch.

They do not materialize all hosted project rows or enumerate all Btrfs
subvolumes or qgroups.

## Automated Validation

The final source state passed:

```text
file-server build
file-server: 14 suites, 54 tests
project-host build
project-host: 108 suites, 664 tests
Python corpus tool bytecode compilation
git diff --check
```

The new tests include:

- filesystem epoch persistence across process restart;
- epoch changes for filesystem identity, quota-mode, and reconciliation
  changes;
- volume identity replacement and deletion;
- a transactional 10,000-row inventory bootstrap;
- targeted Btrfs identity parsing; and
- bounded inventory and project-state queries.

## Staging Deployment

The core artifact was:

```text
20260731T010400Z-98ec7852-storage-scale-20260730-98ec785
```

The final artifact, including exact test cleanup and legacy restore-directory
cleanup, is:

```text
20260731T012718Z-f7dce952-storage-scale-cleanup-20260730
```

Final deployment:

```text
20260731T012814Z-20260731T012718Z-f7dce952-storage-scale-cleanup-20260730
```

The final rollout used `host2` as a 60-second canary, then rolled the other
staging host with concurrency one and a 30-second stabilization period.
Rollout operation `e750f5dd-4e61-45c2-af8c-0f55af403ab1` succeeded.

Both public routes return ready with the correct host identity.

## 10K Test

The disposable `host2` corpus contained:

```text
10,000 synthetic dormant project rows
10,000 synthetic project subvolumes
10,021 total project rows
10,169 total Btrfs subvolumes
10,176 total qgroups
```

The synthetic rows use reserved UUIDs under
`70000000-0000-4000-8000-*`. They have desired run-quota metadata but zero
legacy `disk` and `scratch` fields, so the corpus tests hosted-project
cardinality without implicitly enrolling itself in periodic quota repair.

### Lifecycle

Five warm starts of the same disposable project while the 10K corpus was
present completed in:

```text
3.887 s
3.921 s
3.894 s
3.306 s
3.894 s
```

Mean was 3.780 seconds. Corresponding stops were 1.36-1.72 seconds. The first
start after the final artifact and corpus cleanup completed in 2.848 seconds.

The lifecycle log contained targeted `subvolume show` and targeted qgroup
operations only. It contained no `btrfs subvolume list` and no unfiltered
qgroup enumeration.

### SQLite Queries

Two hundred repetitions of representative queries with 10,021 project rows
produced:

```text
query                         p50         p95         max
project count                 0.005 ms    0.007 ms    0.555 ms
state aggregate               0.569 ms    0.585 ms    0.869 ms
active projects               0.011 ms    0.013 ms    0.119 ms
32-row quota repair batch     0.015 ms    0.015 ms    0.047 ms
32-row volume verify batch    0.056 ms    0.066 ms    1.211 ms
```

### Restart

A component-specific project-host rollout with the full corpus present:

- changed only the project-host process;
- preserved Conat router, Conat persistence, ACP worker, and host-agent PIDs;
- reached ready in approximately 9.9 seconds;
- retained filesystem UUID
  `f294c51c-7416-4760-a56c-3e66502418a6`;
- retained quota mode `simple` and quota epoch `1`;
- retained the original inventory-bootstrap marker and timestamp;
- did not rerun the legacy inventory bootstrap; and
- issued no `btrfs subvolume list`.

The next project start completed in 3.306 seconds.

### Bounded Maintenance

The one-minute quota repair sweep and a full five-minute inventory interval
both ran while the corrected corpus was present. The persisted inventory
cursor advanced, while the synthetic corpus still had exactly zero rows in:

```text
project_volumes
project_volume_quotas
btrfs_quota_queue
```

This demonstrates that recurring work is bounded independently of dormant
hosted-project cardinality.

### Cleanup

Final cleanup removed all 10,000 rows and subvolume paths. Btrfs path deletion
took about 14 seconds; asynchronous qgroup metadata reclamation took another
111 seconds. The tool now waits for that reclamation instead of reporting a
misleading early success.

After cleanup:

```text
synthetic project rows: 0
synthetic subvolumes: 0
synthetic ledger rows: 0
total subvolumes: 169
total qgroups: 176
corpus marker: absent
```

## Additional Staging Fix

Startup exposed an empty `.restore-staging` directory left root-owned by an
older deployment. The file server could read it but failed to remove it as the
runtime user. The final artifact uses the constrained root helper only after
the trusted staging path has been verified empty.

The failure condition was recreated on `host2` before the final canary. The
new artifact removed the directory without a warning.

## Remaining Before Production

The normal project-start scalability objective is met. The following
correctness and observability work remains explicit:

- temporary quota raises in snapshot cleanup and legacy migration are not yet
  represented by a durable override ledger;
- the raw Btrfs quota setter is not yet private to one quota manager;
- operator diagnostics do not yet expose every desired/applied revision,
  identity, epoch, and fast-path decision;
- completely out-of-band subvolumes are not discovered by normal bounded
  inventory verification and require explicit full reconciliation;
- old applied-ledger rows with process-random epochs converge lazily when
  touched rather than through a fleet-wide rewrite; and
- BEES has low I/O weight and bandwidth limits but no explicit IOPS ceiling.

These do not reintroduce an operation proportional to hosted-project count in
normal project startup. They must remain visible in the production-readiness
review rather than being implied complete by the latency result.
