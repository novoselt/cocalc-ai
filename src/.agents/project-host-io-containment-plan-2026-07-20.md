# Project Host I/O Containment Plan

Status: proposed implementation and deployment plan

Date: 2026-07-20

## Executive Summary

CoCalc's shared-host isolation requirement is:

> No project, whether malicious or merely mistaken, may make the project host
> unusable for other projects or for the host control plane.

That requirement is not currently met for storage. A project already has CPU,
memory, PID, and disk-space controls, but it can still saturate the shared block
device with bandwidth, IOPS, or metadata work. A project-triggered recursive
file operation can also make the privileged `project-host` process perform work
whose cost is controlled by untrusted project contents.

The implementation must provide four layers:

1. A portable, persistent `io.max` safety envelope on the aggregate project
   pool and a generous per-project blast-radius limit.
2. Work-conserving, tier-aware fairness when the host kernel and storage stack
   support a validated controller, with a userspace adaptive fallback when they
   do not.
3. Project attribution for all work whose cost depends on project data,
   including recursive live-file deletion and snapshot pruning.
4. Bounded telemetry, pressure response, conformance checks, and failure
   recovery that work at up to thousands of project cgroups per host.

`io.max` is the correctness boundary. `io.weight`, `io.cost`, BFQ, benchmarks,
and adaptive tuning may improve utilization and fairness, but none of them may
be required for basic host survival.

## Why This Is Urgent

### Current blast radius

A few lines of code can currently create one of several host-wide incidents:

- random reads or writes can consume the available IOPS;
- sequential reads or writes can consume the available bandwidth;
- creating or removing millions of files can drive Btrfs metadata work and
  writeback;
- repeatedly traversing a generated tree can evict useful page cache and keep
  the device queue full;
- a project-triggered snapshot prune can move the same untrusted scaling
  problem into `project-host` itself.

Disk quota limits total retained bytes, not the rate or cost of filesystem
operations. CPU limits do not reserve block-device service time. The existing
`io.weight=100` on every project is not a hard limit and is not reliably
effective with the block schedulers used by current cloud VMs.

### July 20 incident

Project `52d00914-04c1-4c7a-83d6-69240c2570f1` on `us-south-1` generated about
5.4 million files under `cowasm/.tmp/current-run`. An unrestricted recursive
scan contributed to severe storage pressure. The host heartbeat became stale
and the UI reported the host unavailable even though some terminals continued
to work.

The subsequent "delete from all snapshots" operation made the privileged
`project-host:app` process consume several CPU cores and multiple GiB of RAM.
Killing that process interrupted snapshot cleanup and left one snapshot
writable until it was repaired. This is both a resource-attribution problem and
a restart-safety problem.

A manual canary then applied this project-leaf limit:

```text
rbps=16777216 wbps=8388608 riops=1000 wiops=500
```

A normal, un-niced `rm -rf` continued making progress while other projects on
the host remained responsive. This is useful production evidence that cgroup
I/O containment can reduce the blast radius. It is not a substitute for the
staging test matrix below, and these numbers must not become fleet defaults.

### Risk if nothing is done

If this remains unchanged, one project can continue to cause:

- host-wide terminal, Jupyter, Codex, file, and heartbeat stalls;
- false host-down banners and unnecessary automated remediation;
- latency or failure for unrelated paying users;
- interrupted privileged cleanup with snapshots or quotas left inconsistent;
- operator reboots that disrupt every project on the host;
- corruption risk in applications that encounter extreme latency or ENOSPC-like
  behavior while the filesystem is under pressure.

This is not an unusual edge case. A recursive file generator, database stress
loop, package cache, compiler, `fio`, or accidental scan is sufficient. The
host must remain safe without identifying intent.

## Non-Negotiable Invariants

1. Project workload processes run below `/sys/fs/cgroup/cocalc-project-pool`.
2. Host control services remain outside that pool and retain a documented
   storage-performance reserve.
3. In enforcement mode, a project start fails closed if its I/O limits cannot
   be applied and verified.
4. Failure to enforce the aggregate pool policy makes a shared host ineligible
   for new placement. It does not automatically kill existing projects.
5. Every process doing work proportional to project-controlled filesystem
   contents is charged to that project's cgroup.
6. Device major/minor numbers are discovered at runtime and never hardcoded.
7. Limits survive reboot, host reconciliation, project restart, cgroup
   recreation, disk growth, and disk reattachment.
8. Unsupported storage backends are reported explicitly; they never silently
   claim containment.
9. No pressure sampler may synchronously walk every process or every project on
   each interval. Sampling must be bounded and expose staleness.
10. Automatic policy changes use hysteresis, cooldowns, audit records, and a
    one-command rollback.

## Goals

- Keep the host control plane responsive during hostile bandwidth, IOPS, and
  metadata workloads.
- Prevent one project from consuming the entire project-pool storage envelope.
- Give higher service classes a larger share under contention.
- Let any project burst when the disk is otherwise idle, subject to the host
  safety envelope and its generous per-project blast-radius ceiling.
- Attribute privileged file work to the project that requested it.
- Preserve descriptor-anchored/openat2 path safety.
- Provide enough evidence to tune GCP, Nebius, and future provider profiles
  independently.
- Make enforcement reversible without replacing or rebooting a host.

## Non-Goals

- Guaranteeing a fixed minimum IOPS or bandwidth to every project.
- Treating local storage containment as a substitute for backups.
- Assuming cloud burst performance is a guaranteed capacity floor.
- Switching every host to BFQ as the first implementation.
- Solving NFS, FUSE, or arbitrary network filesystems with block-cgroup controls.
- Automatically stopping projects for I/O usage in the first production
  rollout.

## Current Architecture

### Existing cgroup hierarchy

Bootstrap creates:

```text
/sys/fs/cgroup/cocalc-project-pool
  legacy
  project-<project-id>
```

The project runner calculates cgroup values in
[`project-runner/run/limits.ts`](../packages/project-runner/run/limits.ts).
Bootstrap applies them through `cocalc-runtime-storage` in
[`server/cloud/bootstrap/bootstrap.py`](../packages/server/cloud/bootstrap/bootstrap.py).
Running project processes are reconciled into project leaves by
[`project-runner/run/podman.ts`](../packages/project-runner/run/podman.ts).

The project pool already reserves host memory and CPU. Each leaf currently gets
the same `io.weight=100`; neither the pool nor normal project leaves have a
persistent `io.max` policy.

BEES is already in a separate cgroup with bounded CPU, memory, and bandwidth.
That implementation supplies reusable device-discovery and diagnostics code,
but BEES limits must remain independent from project-pool limits.

### Current GCP capability observation

On `us-south-1` during the incident:

- cgroup v2 exposed `io.max`, `io.stat`, `io.weight`, and `io.pressure`;
- the Btrfs data disk was `/dev/sdb`, then major/minor `8:16`;
- the active scheduler was `none` with `mq-deadline` available;
- `CONFIG_BLK_CGROUP_IOCOST` was present, but `io.cost.model` and `io.cost.qos`
  were empty, so `io.cost` was not enabled;
- `io.latency` was not exposed.

This means `io.max` is available now, while the current `io.weight` should not
be treated as an enforced service share.

### Project-triggered host work

There are two important recursive-delete paths:

- [`backend/sandbox/index.ts`](../packages/backend/sandbox/index.ts) invokes the
  native openat2 helper synchronously for safe recursive removal in the normal
  path. Its privileged path starts a subprocess, but does not identify and
  attach that work to a project leaf.
- [`file-server/btrfs/subvolume-snapshots.ts`](../packages/file-server/btrfs/subvolume-snapshots.ts)
  makes every selected snapshot writable, recursively removes the path with
  Node, and restores read-only state, all while holding the Btrfs mutation lock
  and temporary quota relief.

The frontend waits synchronously for these operations in
[`frontend/project/redux/file-operations.ts`](../packages/frontend/project/redux/file-operations.ts).
This design is not safe for trees containing millions of entries.

## Storage-Control Primitives

### `io.max`: required portable safety layer

`io.max` can set per-device read/write bandwidth and read/write IOPS ceilings:

```text
MAJOR:MINOR rbps=N wbps=N riops=N wiops=N
```

Advantages:

- available on modern cgroup v2 Linux hosts across common cloud block devices;
- independent of BFQ and normally effective with `none`/`mq-deadline`;
- hierarchical, so the project pool and each project can both have limits;
- simple to verify and reset.

Limitations:

- hard caps are not inherently work-conserving;
- cached reads do not consume block I/O at the time of the read;
- buffered writes and Btrfs metadata can be charged later;
- some kernel filesystem work may not be attributed exactly as expected;
- it does not contain VFS traversal CPU, dentries, page cache, filesystem locks,
  or the `project-host` event loop.

These limitations are why project-attributed workers and CPU/memory controls
are part of this plan.

### `io.weight`: desired semantics, not a safety boundary

Weights express the product behavior CoCalc wants: unused capacity can be
borrowed, while contending projects receive service proportional to class.
However, weights only matter when the active block controller/scheduler honors
them. Writing a value successfully is not evidence that it affects service.

The implementation will continue writing and reporting weights, but it will not
declare weighted fairness active until a staging contention test proves it.

### `io.cost`: optional work-conserving enhancement

The current GCP kernel includes `io.cost`. If enabled and correctly modeled,
`io.cost` can make cgroup weights effective without switching to BFQ.

It must be capability-gated and provider-profile-specific because:

- cloud disk latency and burst capacity vary over time;
- an automatic model can learn an opportunistic peak rather than a guaranteed
  floor;
- a bad model can cause throttling or poor fairness;
- future providers and device-mapper stacks may behave differently.

The baseline design must remain safe with `io.cost` disabled.

### BFQ and `io.latency`

BFQ can provide weighted fairness on supported devices, but changing the live
block scheduler has wider performance implications. It is an optional isolated
experiment, not an initial fleet policy.

`io.latency` would be useful for protecting a latency-sensitive control cgroup,
but it is not exposed on the current GCP host and cannot be a dependency.

### Userspace adaptive caps

When kernel weighted fairness is unavailable, a controller can approximate
work-conserving behavior by changing project `io.max` values only during
sustained contention. This is less precise than kernel scheduling, but it is
portable, observable, and reversible.

## Target Cgroup Model

```text
/sys/fs/cgroup
  cocalc-project-pool                 aggregate project safety envelope
    legacy                            migration fallback only
    project-<project-id>              project runtime and attributed workers
  cocalc-bees                         existing bounded BEES maintenance
  cocalc-maintenance                  other explicitly bounded host maintenance
  system.slice/...                    project-host, host agent, Conat, SSH
```

The first implementation does not need to move every control service into a new
common cgroup. It does need to prove that those services are outside
`cocalc-project-pool` and that no project runtime remains in `legacy` after
reconciliation.

Background host work must be classified deliberately:

- BEES remains in its current cgroup.
- Backups, scans, and non-user maintenance belong in `cocalc-maintenance` with
  low weights and hard ceilings.
- User-triggered recursive filesystem work belongs in the triggering
  `project-<project-id>` leaf, even if it needs a narrow privileged helper.
- `project-host`, Conat, host-agent, SSH, and health probes remain outside the
  project pool.

## Policy Model

### Host policy file

Use a versioned root-owned policy file rather than accumulating unrelated
environment variables:

```text
/etc/cocalc/project-io-policy.json
```

Bootstrap owns the base file. A separate override file may be used for a canary
without having bootstrap overwrite it. A proposed schema is:

```json
{
  "version": 1,
  "mode": "observe",
  "mountpoint": "/mnt/cocalc",
  "profile": "gcp-pd-balanced",
  "capacitySource": "provider-floor",
  "pool": {
    "rbps": 0,
    "wbps": 0,
    "riops": 0,
    "wiops": 0
  },
  "leafClasses": {
    "standard": { "weight": 100, "maxFraction": 0.6 },
    "member": { "weight": 200, "maxFraction": 0.75 },
    "premium": { "weight": 400, "maxFraction": 0.9 }
  },
  "adaptive": {
    "enabled": false,
    "sampleMs": 5000,
    "enterSamples": 6,
    "recoverSamples": 24
  },
  "ioCost": { "mode": "disabled" }
}
```

Zero values in this example mean "not configured", not unlimited. Enforce mode
must reject an incomplete policy. Exact field names and defaults should be
finalized with tests before implementation.

Modes:

- `disabled`: preserve legacy behavior and report capability only;
- `observe`: calculate and publish the policy but do not write limits;
- `enforce`: write, reconcile, and verify limits; containment failures degrade
  host runtime health and stop new placement.

### Capacity source

Do not derive a permanent cap from a single `fio` run. Cloud benchmarks can see
temporary burst or spare capacity that is not guaranteed later.

For each provider/disk profile, record:

- documented minimum or provisioned IOPS and bandwidth;
- VM-level I/O limits;
- disk size/type and number of attached disks sharing the limit;
- whether read and write limits are independent or share an aggregate limit;
- an explicit absolute reserve for control and filesystem maintenance;
- the provenance and timestamp of the profile.

The project-pool ceiling is computed conservatively from the lowest applicable
provider and VM envelope minus an absolute control-plane reserve. A percentage
of an opportunistic benchmark is not an acceptable capacity source.

For GCP Persistent Disk, disk size, disk type, VM family/vCPU count, and other
attached disks all affect the documented envelope. Existing dedicated-disk
pricing metadata in [`util/upgrades/dedicated.ts`](../packages/util/upgrades/dedicated.ts)
is not sufficient as an enforcement source because it does not represent every
baseline, VM cap, or shared-device condition.

If a provider has no trustworthy floor, enforcement requires an explicit
operator-supplied conservative profile. Observe mode can still collect data.

### Aggregate project-pool ceiling

Apply all four controls to every backing block device of the Btrfs project
filesystem:

```text
rbps, wbps, riops, wiops
```

Bandwidth alone does not contain millions of small operations. IOPS alone does
not contain sequential streaming. Both are required.

The parent ceiling has two purposes:

- reserve device service for host-critical processes outside the pool;
- bound the combined damage from many projects or an incorrectly relaxed leaf.

It is not intended to divide service among projects.

### Per-project blast-radius ceiling

Every project leaf receives a persistent, relatively generous hard ceiling as
well as its weight. The ceiling may vary by service class, but even the highest
shared-host class remains below the aggregate pool maximum.

This sacrifices a small amount of theoretical single-project peak performance
in exchange for preventing one project from consuming the entire project pool.
A standard idle project should still be able to use a large fraction of the
safe pool capacity. Dedicated/private project hosts may select a separate
profile whose one leaf can approach the pool ceiling.

Initial class ratios should be modest, for example `100:200:400`, rather than
orders of magnitude apart. The ratios are product policy; the exact limits must
come from staging measurements.

### Tier authority

The project host must not independently query or infer account membership. The
owning bay resolves the authoritative run policy and sends an explicit
`io_class` or equivalent value in project runner configuration. Extend:

- [`conat/project/runner/types.ts`](../packages/conat/project/runner/types.ts);
- [`project-host/run-quota.ts`](../packages/project-host/run-quota.ts);
- [`project-runner/run/limits.ts`](../packages/project-runner/run/limits.ts).

Unknown or missing classes map to the safest normal shared-host class. The host
policy maps the class to a weight and a blast-radius maximum.

### Adaptive contention policy

After static containment is stable, add a host-local state machine:

```text
NORMAL -> CONTENDED -> RECOVERY -> NORMAL
                 \-> EMERGENCY
```

Inputs:

- project-pool and device `io.pressure` deltas;
- pool and leaf `io.stat` deltas;
- `/proc/diskstats` queue, service-time, and throughput deltas;
- project-host event-loop delay and file-RPC latency;
- host heartbeat latency/failures;
- active project classes and project-attributed maintenance operations;
- Btrfs data/metadata pressure.

Behavior:

1. `NORMAL`: retain the generous static leaf ceilings. If validated `io.cost`
   is active, weights provide normal work-conserving sharing.
2. `CONTENDED`: after several consecutive pressure samples, identify projects
   responsible for the largest recent I/O deltas. Compute bounded weighted
   shares and lower their leaf ceilings. Redistribute unused share to projects
   that demonstrate demand, up to each class maximum.
3. `EMERGENCY`: immediately apply conservative offender and pool caps if host
   control latency or heartbeat health is threatened. Do not stop projects in
   the first rollout.
4. `RECOVERY`: require a substantially longer healthy window, then raise limits
   in steps. Clear temporary caps only after sustained recovery.

The controller may only tighten within the configured static envelope; it may
not exceed provider-profile maxima. Every transition and cap change is audited.
Manual overrides have a TTL and a reason.

`io.stat` can lag buffered metadata work, so dominant-project selection must
also use known worker ownership and recent project activity. If attribution is
ambiguous, tighten the aggregate pool rather than accusing or stopping a random
project.

## Device and Capability Discovery

Add one shared implementation used by bootstrap, runtime conformance, metrics,
and policy reconciliation.

For the configured project mount:

1. Resolve the mount and filesystem type with `findmnt`/mountinfo.
2. For Btrfs, enumerate every backing block device with `btrfs filesystem show
--raw`.
3. Resolve each current device to major/minor and stable identity.
4. Detect device-mapper, RAID, multipath, and network-filesystem cases.
5. Verify cgroup v2 and the delegated `io` controller.
6. Detect readable/writable `io.max`, `io.weight`, `io.stat`, and `io.pressure`.
7. Detect `io.cost` files and whether a model/QoS is actually active.
8. Record the scheduler and kernel version.

The result is a typed capability snapshot published in host metrics. It must
distinguish `available`, `enabled`, `validated`, and `unsupported`.

When a device changes, reconciliation explicitly clears stale major/minor
entries and writes the current entries. Tests must cover device renumbering and
multi-device Btrfs. Never assume the incident's `8:16` device number.

Backend policy:

- local block filesystem with cgroup v2: support `io.max`;
- device-mapper/multi-device: support only after staging proves the chosen
  control layer receives accounting;
- NFS/FUSE/network filesystem: report unsupported and use a provider-specific
  mechanism or dedicated-host policy;
- old/non-v2 kernel: shared-host enforce mode is non-conformant.

## Project-Attributed Filesystem Workers

Static block limits are insufficient while project-controlled traversal runs in
the `project-host` process. Recursive operations must become separate workers.

### Worker boundary

Create a project storage-operation worker with these properties:

- receives an operation ID, project ID, operation type, and descriptor-anchored
  target; never an unrestricted shell command;
- is attached to `project-<project-id>` before opening or traversing project
  content;
- inherits that leaf's CPU, memory, PID, bandwidth, and IOPS policy;
- uses the existing native openat2-safe primitives or an equivalent narrow
  helper;
- has bounded stdout/stderr, memory, and concurrency;
- publishes progress, cancellation state, and the last safe checkpoint;
- can be killed without killing `project-host`.

The privileged helper must verify both the target root and project identity. A
caller may not attach a worker to another project's leaf or supply an arbitrary
root. Prefer launching an unprivileged project-attributed worker and letting
its narrow privileged child inherit the leaf, rather than moving the main host
process.

### Live recursive delete

For a live tree:

1. Validate the target with the current descriptor-anchored rules.
2. Atomically rename it to a hidden per-project trash path when possible, so
   the user-visible delete completes quickly and new work does not recreate
   entries inside the tree being traversed.
3. Enqueue an idempotent background removal operation.
4. Delete in bounded batches or allow the native helper to run under the
   project cgroup, reporting periodic counters.
5. Retry after worker or host restart.

Trash bytes continue counting against project quota until reclaimed. The UI
must say this clearly and show cleanup progress when quota pressure matters.

### Snapshot path pruning

Snapshot pruning needs a durable journal because it temporarily changes
filesystem invariants. Persist at least:

- operation ID and project ID;
- target relative path;
- requested snapshot list;
- current snapshot/checkpoint;
- original quota and temporary quota;
- whether the current snapshot was made writable;
- timestamps, worker PID/cgroup, and last error.

For each snapshot:

1. Acquire the Btrfs mutation lock only for the state transition that requires
   it; do not hold one host-wide lock across millions of unlinks unless Btrfs
   correctness requires it.
2. Record the intended transition durably.
3. Apply temporary quota relief.
4. Make exactly one snapshot writable.
5. run the project-attributed delete worker;
6. restore read-only state in a separately retryable cleanup step;
7. restore quota and checkpoint completion;
8. release the lock before moving to the next snapshot.

On startup, reconciliation scans incomplete operations and restores every
recorded snapshot to read-only and every recorded quota to its original value
before retrying or failing the operation. Missing snapshots or vanished files
are successful idempotent outcomes, not fatal catalog inconsistencies.

Limit concurrency to one destructive storage operation per project and a small
host-wide maximum. Snapshot creation/deletion and Btrfs maintenance must remain
responsive while a large prune is in progress.

### API behavior

Replace the long synchronous frontend wait with a normal long-running operation:

- request returns an operation ID promptly;
- progress survives browser disconnect and hub restart;
- cancellation is best-effort and always runs invariant restoration;
- UI distinguishes "removed from live namespace" from "space reclaimed";
- operations time out as stale only after the worker has been reconciled, not
  because an HTTP/RPC timer elapsed.

## Telemetry and Diagnostics

### Host metrics

Extend [`conat/hub/api/hosts.ts`](../packages/conat/hub/api/hosts.ts) and
[`project-host/host-metrics.ts`](../packages/project-host/host-metrics.ts) with
a typed I/O containment snapshot:

- policy mode/version/profile and last reconcile time;
- discovered devices, filesystem, scheduler, and capability states;
- configured and effective pool `io.max` and `io.weight`;
- pool `io.stat` rates and parsed `io.pressure` values/totals;
- `/proc/diskstats` rates, queue depth, and derived latency where valid;
- bounded top-project I/O consumers with sample age and truncation flags;
- current adaptive state, temporary limits, reason, and cooldown;
- active storage operations, worker cgroups, progress, and invariant state;
- count of project processes in `legacy` or outside the expected hierarchy;
- conformance errors and unsupported-backend reasons.

The existing 15-second host metric cadence is appropriate for fleet history.
The local controller may sample more frequently without sending every sample to
the bay.

### Bounded project sampler

Hosts can have 500 normal active projects and may be stress-tested with 2,000.
Do not synchronously read every leaf on every tick.

Use a rolling sampler:

- always sample the aggregate pool and block devices;
- sample active storage-operation leaves every tick;
- sample recently active/running projects first;
- scan a bounded number of remaining leaves per interval;
- maintain deltas and sample timestamps in memory;
- publish stale, partial, missing, and truncated counts;
- perform a bounded accelerated scan only after aggregate pressure rises.

### Control-plane service indicators

Storage containment is successful only if user-visible and control-plane work
survives. Record:

- project-host event-loop delay;
- registry heartbeat duration and consecutive failures;
- representative file RPC latency;
- terminal/Codex worker health where already available;
- Btrfs mutation queue depth and oldest operation age.

### Alerts

Normal pressure and automatic throttling belong in `/admin/usage-stats` and
host metrics, not immediate operator notifications. Alert only when:

- enforce-mode containment is missing or cannot be reconciled;
- control-plane health remains degraded after automatic tightening;
- an operation cannot restore snapshot read-only state or quota;
- pressure remains emergency-level with no attributable or controllable work;
- the host is no longer safe for placement.

Recovery notifications are unnecessary unless they close an actionable alert.

## Implementation Phases

### Phase 0: capability and measurement, no behavior change

1. Add typed parsing for `io.max`, `io.stat`, `io.pressure`, and diskstats.
2. Implement shared backing-device/capability discovery.
3. Add the I/O metrics snapshot and bounded leaf sampler.
4. Add runtime-health checks for project placement and effective limits.
5. Record current provider/disk metadata and establish explicit staging
   profiles.
6. Add an admin diagnostic command that prints capability, policy, effective
   limits, pressure, top consumers, and worker attribution without mutation.

Likely files:

- `packages/project-host/host-metrics.ts`;
- new `packages/project-host/io-metrics.ts` and tests;
- `packages/conat/hub/api/hosts.ts`;
- `packages/project-host/runtime-health.ts`;
- `packages/project-host/runtime-conformance.ts`;
- `packages/server/cloud/bootstrap/bootstrap.py` and tests;
- host admin/CLI diagnostics.

Exit criterion: staging and at least one read-only production sample explain the
actual device, available controllers, project-pool usage, and top consumers.

### Phase 1: persistent static safety envelope

1. Add policy-file generation and override handling to bootstrap.
2. Extend `cocalc-runtime-storage` to validate, apply, clear, and inspect pool
   and leaf `io.max` values.
3. Add all four pool controls: read/write BPS and read/write IOPS.
4. Carry an explicit `io_class` through owning-bay run policy.
5. Map `io_class` to bounded weight and permanent leaf blast-radius limits.
6. Extend project-cgroup conformance checks to verify `io.max`, not only
   `io.weight`.
7. Reapply limits during project and host reconciliation.
8. Make enforce-mode failure block new starts/placement on that host.
9. Add a TTL-based audited CLI override for canaries and emergencies.

Likely files:

- `packages/conat/project/runner/types.ts`;
- `packages/project-host/run-quota.ts`;
- `packages/project-runner/run/limits.ts` and tests;
- `packages/project-runner/run/podman.ts` and tests;
- `packages/server/cloud/bootstrap/bootstrap.py` and tests;
- `packages/project-host/reconcile.ts` and runtime conformance tests.

Exit criterion: a project cannot exceed its effective leaf limit, all projects
combined cannot exceed the pool policy, and control services remain responsive
under sustained read, write, and small-I/O stress.

### Phase 2: project-attributed destructive storage workers

1. Introduce durable storage-operation records and worker lifecycle management.
2. Move recursive live delete out of the main `project-host` process.
3. Move snapshot recursive pruning out of the main process.
4. Attach workers and privileged children to the triggering project leaf before
   any content-dependent work.
5. Add atomic trash rename for live paths where supported.
6. Journal and reconcile snapshot read-only/quota transitions.
7. Convert frontend operations to progress-based LROs.
8. Bound project and host concurrency.

Likely files:

- `packages/backend/sandbox/index.ts` and `privileged-delete.ts`;
- `packages/file-server/btrfs/subvolume-snapshots.ts`;
- new project-host SQLite storage-operation module;
- project-host file/snapshot RPC handlers;
- frontend file operation progress UI.

Exit criterion: killing the worker or `project-host` at every transition leaves
no writable snapshot, leaked quota relief, or untracked operation, and the main
event loop stays responsive while deleting millions of entries.

### Phase 3: work-conserving fairness experiment

1. Validate whether `io.cost` makes weights effective on staging GCP PD without
   damaging latency or throughput.
2. Repeat on Nebius storage; do not copy GCP model parameters.
3. Compare disabled, automatic-model, and explicit conservative-model modes.
4. If `io.cost` is stable, enable it only for that validated provider profile.
5. If it is not stable, leave it disabled and proceed with adaptive `io.max`.
6. Keep BFQ as a separate disposable-VM experiment.

Exit criterion: under two or more continuously demanding projects, observed
service shares follow configured weights within a documented tolerance while an
idle project can burst up to its leaf/pool envelope.

### Phase 4: adaptive pressure controller

1. Add the `NORMAL`/`CONTENDED`/`EMERGENCY`/`RECOVERY` state machine.
2. Reuse the existing host-pressure controller patterns for timers, cooldowns,
   state publication, and bounded candidate selection.
3. Start in `signal` mode, calculating but not applying temporary caps.
4. Compare calculated offenders and shares against controlled staging loads.
5. Enable enforcement without automatic project stops.
6. Add stop/quarantine policy only after separate review and production data.

Exit criterion: the controller reacts to pressure, preserves tier ratios,
avoids oscillation, and automatically restores burst capacity after recovery.

## Staging Test Matrix

Use a disposable data set and at least two normal projects plus a control
project. Record all effective limits and telemetry before each run.

### Block I/O tests

- sequential read saturation;
- sequential write saturation with sync and buffered writes;
- random 4 KiB read IOPS saturation;
- random 4 KiB write IOPS saturation;
- mixed read/write load;
- one offender, several offenders, and all projects active;
- free/member/premium class contention;
- one idle project using otherwise unused capacity;
- pool cap reached while host control traffic remains active.

Use direct I/O where appropriate to prove device throttling, then repeat with
buffered I/O to measure writeback behavior.

### Metadata and filesystem tests

- create, list, scan, and delete at least 5 million small files;
- perform the same delete through the file UI/API;
- prune the path from multiple snapshots;
- run file listing, terminal, Jupyter, and Codex in unrelated projects;
- run BEES and backup/maintenance concurrently;
- fill a project close to quota and repeat cleanup;
- measure Btrfs transaction and metadata pressure.

### Failure injection

Kill the storage worker and `project-host` independently at each point:

- before and after trash rename;
- after quota relief;
- after making a snapshot writable;
- midway through recursive deletion;
- after deletion but before restoring read-only state;
- after restoring read-only state but before restoring quota;
- between snapshots.

After every failure, verify all snapshots are read-only, quota is restored,
cleanup is resumable, and unrelated projects remain usable.

### Reconciliation and portability

- restart a project and verify leaf limits persist;
- reboot the host and verify pool/leaf limits reconcile;
- recreate a leaf cgroup while the project is stopped/started;
- grow and reattach the data disk so major/minor may change;
- test multi-device Btrfs in a disposable VM;
- test a host with `io.cost` available but disabled;
- test a host without supported block-cgroup control;
- test GCP and Nebius profiles independently;
- verify stale `io.max` device entries are cleared.

## Acceptance Criteria

Before production canary:

- 100% of project runtime and attributed worker PIDs are in the expected leaf;
- no shared project can exceed its configured leaf BPS or IOPS envelope in a
  direct-I/O test;
- the aggregate project pool cannot exceed its configured envelope;
- the control project's terminal, file RPC, and Codex remain responsive during
  every stress test;
- no project-host heartbeat becomes stale because of project I/O;
- `project-host` event-loop delay remains within the normal operational range;
- an idle project receives most of the safe pool capacity allowed by its class;
- weighted shares are either proven effective or explicitly reported inactive;
- killing cleanup at every checkpoint restores snapshot and quota invariants;
- unsupported hosts report non-conformance and do not silently enforce nothing;
- the rollback command clears temporary and persistent caps to the documented
  prior state.

Exact latency and share thresholds should be set from the Phase 0 staging
baseline, then committed to the test harness. They must not be selected after
looking at a failing production result.

## Deployment Plan

### 1. Staging observation

- Deploy Phase 0 to staging hub and project hosts.
- Run for at least 24 hours to verify bounded metric cost and device discovery.
- Confirm no heartbeat or event-loop regression from the sampler.

### 2. Staging enforcement

- Enable a conservative explicit policy on one staging host.
- Run the entire block-I/O and metadata test matrix.
- Enable on all staging shared hosts and soak for at least 24 hours.
- Validate fresh bootstrap and in-place reconciliation.

### 3. Storage-worker staging

- Deploy the LRO/worker changes to staging.
- Recreate the 5.4-million-file scenario and all failure-injection points.
- Do not proceed while any operation can leave a snapshot writable or quota
  relief active.

### 4. Production canary

- Select one lower-risk shared GCP host with known disk profile and active
  operator coverage.
- Start in observe mode, compare calculated policy with real rates, then switch
  to enforce mode through an audited TTL override.
- Do not reuse the manual `us-south-1` leaf values as fleet defaults.
- Monitor control latency, project complaints, PSI, effective limits, and
  operation recovery for at least 24 hours.

### 5. GCP rollout

- Roll out one disk/VM profile at a time.
- Keep fleet spacing and an immediate disable switch.
- Soak each cohort before increasing it.
- Leave automatic stopping disabled.

### 6. Nebius and other providers

- Repeat capability discovery and stress validation.
- Require a provider-specific capacity source and profile.
- Fall back to explicit conservative `io.max` only; never assume GCP behavior.

### 7. Fairness/adaptive rollout

- Roll out `io.cost` only on profiles that passed the contention test.
- Run the adaptive controller in signal mode before enforcement.
- Review production share and pressure data before adding any stop policy.

## Rollback

Provide one audited command that:

1. sets policy mode to `disabled` or `observe`;
2. resets every current pool/leaf device entry to `max`;
3. disables the CoCalc-managed `io.cost` configuration if CoCalc enabled it;
4. stops applying adaptive overrides;
5. leaves CPU, memory, PID, quota, and BEES controls unchanged;
6. verifies effective state and records who performed the rollback.

Rollback must not require a host reboot. Re-enabling must rerun device discovery
rather than restoring cached major/minor values.

## Operational Runbook

The eventual CLI should support:

```text
cocalc host io status <host>
cocalc host io top <host> --window 60s
cocalc host io policy <host>
cocalc host io canary <host> --policy <file> --ttl 2h
cocalc host io disable <host> --reason <text>
cocalc project io status <project-id>
cocalc project storage-operations <project-id>
```

`status` and `top` are read-only. Mutations require fresh elevated auth and
write an audit record. The health checklist should include policy conformance,
unattributed work, stale operations, writable snapshots, and sustained I/O
pressure, but should not notify operators for transient self-corrected caps.

## Open Questions Requiring Staging Data

1. What absolute control-plane IOPS and bandwidth reserve keeps file RPC,
   heartbeat, SSH, and Btrfs administration responsive on each host profile?
2. How much Btrfs metadata/writeback work is correctly charged to the
   originating project cgroup on current kernels?
3. What permanent leaf maximum gives useful idle burst while preserving enough
   service for unrelated projects before the adaptive controller reacts?
4. Is `io.cost` stable enough on GCP PD and Nebius to make weights trustworthy?
5. Which project tier field should be authoritative for `io_class` in the
   owning bay's resolved run policy?
6. Should dedicated/private hosts use the same aggregate reserve or a distinct
   profile?
7. How much trash space and how many pending cleanup operations should be
   allowed per project?
8. Can Btrfs snapshot prune safely release the mutation lock during recursive
   unlink, or does it require a narrower per-project/per-subvolume lock?

These questions affect tuning and utilization, not whether the basic hard
containment layer should be implemented.

## Recommended Immediate Ordering

1. Land Phase 0 telemetry and capability discovery.
2. Land static pool and leaf `io.max` enforcement behind `observe`/`enforce`
   modes.
3. Prove bandwidth plus IOPS containment with the existing pathological
   project fixture in staging.
4. Move recursive delete and snapshot prune into project-attributed durable
   workers.
5. Canary the static safety layer on one production host.
6. Only then optimize utilization with `io.cost` or adaptive weighted caps.

The hard static layer should not wait for a perfect work-conserving scheduler.
The present architecture permits one project to threaten the host, and closing
that safety gap is more important than extracting the last fraction of idle
disk performance.
