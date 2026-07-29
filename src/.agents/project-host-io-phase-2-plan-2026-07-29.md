# Project Host I/O Phase 2 Plan

Date: 2026-07-29

Status: implementation plan; no production behavior is changed by this
document.

## Executive Decision

Phase 2 will make project-host I/O containment complete, durable, and
operationally useful. It will not treat successfully writing `io.weight` as
proof of fair sharing.

The implementation order is:

1. move heavy project-attributed storage work out of the shared project-host
   process and into the owning project's cgroup;
2. move genuinely host-wide maintenance into a separate bounded maintenance
   cgroup;
3. give project lifecycle and user-requested work admission priority over
   scheduled maintenance;
4. make the existing `io.max` policy a durable, reconciled control-plane
   assignment and complete the site-owned GCP rollout;
5. test `io.cost` as an explicitly capability-gated work-conserving fairness
   layer;
6. use an adaptive userspace `io.max` controller if `io.cost` cannot meet the
   acceptance criteria.

The immediate correctness boundary remains hierarchical `io.max`. Weighted
fairness is a later enhancement. BFQ is not part of the production plan.

## Relationship To Existing Plans

This document continues, rather than replaces:

- [`project-host-io-containment-plan-2026-07-20.md`](./project-host-io-containment-plan-2026-07-20.md),
  which defines the Phase 1 safety envelope and the original multi-phase
  strategy;
- [`project-attributed-storage-operations-design-2026-07-22.md`](./project-attributed-storage-operations-design-2026-07-22.md),
  which remains authoritative for durable storage-operation journaling,
  fencing, leases, and worker recovery;
- [`project-host-io-containment-final-staging-results-2026-07-22.md`](./project-host-io-containment-final-staging-results-2026-07-22.md),
  which records the first complete static containment validation;
- [`project-host-io-capacity-staging-results-2026-07-24.md`](./project-host-io-capacity-staging-results-2026-07-24.md),
  which defines and validates capacity-aware GCP `pd-balanced` limits.

The earlier documents intentionally stopped before a general production
rollout. This plan starts from the production evidence gathered on July 29 and
turns the remaining work into an executable sequence.

## Production Evidence

### Fleet policy state

A read-only production check on 2026-07-29 found 18 running, admin-visible
project hosts:

- 4 hosts reported `policy_mode=enforce` and `capability=validated`;
- 14 hosts reported `policy_mode=disabled`, profile `unconfigured`, and no pool
  `io.max`;
- among the 13 site-owned hosts, 4 enforced the policy and 9 did not.

The enforcing site-owned hosts were:

- `montreal-1`;
- `us-south-2`;
- `wstein`;
- `oceania-1`.

This is a partial production canary, not a fleet-wide policy.

The state is not ordinary reconciliation drift. The bootstrap base policy is
created as `disabled`; the enforcing hosts have explicit
`/etc/cocalc/project-io-policy.override.json` files. Hosts without that override
remain disabled. The effective assignment is therefore host-local state rather
than a complete durable control-plane projection.

### `montreal-1` containment state

`montreal-1`, host ID `12869982-da11-495e-9914-ee784ee8d5a8`, reported:

- policy profile `prod-gcp-pd-balanced-dynamic-v1`;
- device `/dev/sdb`, cgroup device `8:16`;
- scheduler `none`;
- aggregate pool limits:
  - read: 120 MiB/s;
  - write: 50 MiB/s;
  - read IOPS: 3300;
  - write IOPS: 1650;
- 137 populated project leaves;
- no legacy project-pool processes;
- a non-empty, matching `io.max` on all 137 leaves.

The leaf limits were:

| Class      |     Read |      Write | Read IOPS | Write IOPS | Written weight |
| ---------- | -------: | ---------: | --------: | ---------: | -------------: |
| `standard` | 30 MiB/s | 12.5 MiB/s |       825 |        412 |            100 |
| `member`   | 60 MiB/s |   25 MiB/s |      1650 |        825 |            200 |
| `premium`  | 90 MiB/s | 37.5 MiB/s |      2475 |       1237 |            400 |

These are hard blast-radius ceilings. They are not work-conserving fair
sharing. The active scheduler is `none`, `io.cost` is unset, and adaptive
control is disabled.

### July 29 lifecycle incident

The rolling 60-minute browser-observed warm-project start P95 reached 28.8
seconds with only 19 samples. Two samples dominated the percentile, and both
were on `montreal-1`:

- one start took 27.8 seconds in the browser and 27.3 seconds in the backend;
- one start took 37.7 seconds in the browser and 36.6 seconds in the backend.

The first start spent about 23.4 seconds in `podman run`.

The second start overlapped a Btrfs snapshot deletion that held the shared
Btrfs mutation lock for 18.925 seconds. The lifecycle runner began immediately
after that lock was released. The same interval had:

- repeated project-host event-loop stalls;
- I/O PSI full pressure in the 13% to 26% range;
- scheduled snapshot and backup work;
- highly occupied Btrfs metadata allocation.

The slow samples were therefore real backend delays, not merely percentile
noise or frontend telemetry artifacts.

### Containment bypass

Live process inspection showed the project-host app and its Btrfs helper
children in:

```text
/system.slice/cocalc-project-host-watchdog.service
```

They were not in:

```text
/sys/fs/cgroup/cocalc-project-pool/project-<project-id>
```

Consequently, the Btrfs snapshot deletion bypassed both:

- the affected project's leaf `io.max`;
- the aggregate project-pool `io.max`.

This is the most important Phase 2 gap. Completing the leaf-policy rollout
without fixing storage-worker placement would not prevent the observed
incident.

## Problem Statement

Phase 1 bounds ordinary project runtime I/O on the hosts where it is enabled.
It does not yet guarantee:

1. that every heavy project-attributed operation runs in the owning project's
   cgroup;
2. that host maintenance has a separate aggregate safety envelope;
3. that scheduled maintenance yields to project starts and user-visible work;
4. that policy assignments survive reprovisioning and converge across the
   fleet;
5. that class weights produce measurable work-conserving fairness;
6. that the controller reacts when Btrfs metadata work or buffered writeback
   creates sustained pressure;
7. that operators can distinguish hard caps, verified fairness, and disabled
   policy from one status surface.

The result is a split safety model: ordinary containers can be contained while
the shared host process still performs unbounded project work.

## Non-Negotiable Invariants

1. The project-host control process, host agent, Conat services, SSH, and health
   endpoints remain outside the project I/O pool.
2. Heavy work initiated for one project is attributed to that project before
   its first storage operation.
3. Project-attributed workers never receive a generic privileged command
   channel.
4. Host-wide maintenance has an explicit bounded cgroup and cannot silently run
   in the project-host service cgroup.
5. Scheduled maintenance cannot begin while foreground lifecycle work is
   active unless the maintenance is required to restore host capacity.
6. A new foreground request does not unsafely kill an in-progress Btrfs
   transaction. It prevents new background admission and causes durable work to
   yield at its next safe checkpoint.
7. `io.max` remains the correctness boundary even when `io.cost` or an adaptive
   controller is enabled.
8. Weighted fairness is reported as active only after a provider-specific
   contention test proves it.
9. Policy assignment is authoritative in the host's owning bay and is projected
   explicitly to the host.
10. A host assigned to `enforce` is not eligible for new placement until it
    reports the same policy generation and a validated effective state.
11. Policy drift alone is an operator condition. It must not create a
    user-visible "host unavailable" banner when existing project traffic is
    healthy.
12. Rollback never deletes project data, snapshots, backups, or operation
    journals.
13. The first production release does not automatically stop projects in
    response to I/O pressure.
14. Dedicated and non-GCP hosts are not assigned a shared-host GCP profile by
    assumption.

## Goals

- Prevent one project or one scheduled maintenance stream from making unrelated
  projects unusable.
- Preserve project lifecycle responsiveness during backup and snapshot
  maintenance.
- Ensure all site-owned GCP shared hosts converge to a validated hard-cap
  profile.
- Preserve unused-capacity borrowing when a proven controller can provide it.
- Make foreground/background admission and I/O policy state observable and
  auditable.
- Keep host-local operation recovery independent of temporary hub or Conat
  availability.
- Keep provider capacity and fairness models explicit and versioned.

## Non-Goals

- Replacing Btrfs.
- Changing project storage layout.
- Switching production disks to BFQ.
- Relying on `ionice` as a correctness boundary.
- Automatically killing or stopping projects for I/O use in this phase.
- Giving users arbitrary control over raw BPS, IOPS, cgroup, or scheduler
  values.
- Routing steady-state project I/O through a hub.
- Making one global model apply to GCP, Nebius, dedicated hosts, local
  Launchpad, and unknown storage stacks.
- Solving CPU-heavy metadata traversal only with block-I/O controls.

## Target Cgroup Architecture

The target hierarchy is:

```text
/sys/fs/cgroup
  system.slice/cocalc-project-host-watchdog.service
    project-host app and control services only

  cocalc-project-pool
    legacy
    project-<project-id>
      project runtime
      project file services
      project-attributed storage workers

  cocalc-maintenance
    bounded host-wide maintenance workers

  cocalc-bees
    existing bounded BEES workers
```

The project-host process remains outside the pool so it can authorize,
schedule, report, and recover work under project pressure. It must not perform
heavy storage operations itself.

### Initial project-worker placement

The initial implementation keeps runtime and attributed workers in the existing
project leaf. This immediately applies:

- the project class `io.max`;
- the project class `io.weight`;
- aggregate project-pool limits;
- existing project attribution in `io.stat`.

Do not add nested `runtime` and `maintenance` children in the first release.
That requires a live cgroup migration and controller-layout change. Consider it
later only if the shared leaf cannot provide enough distinction between a
project's interactive runtime and its own background storage worker.

### Host-maintenance placement

`cocalc-maintenance` is for work that is not correctly chargeable to one
project, including:

- host-global snapshot catalog cleanup;
- rootfs cache cleanup and replication;
- orphan cleanup without an authoritative project owner;
- capacity reconciliation;
- other explicitly classified host-scoped storage work.

The maintenance cgroup receives:

- a provider-profile `io.max`;
- CPU and memory limits where appropriate;
- PID limits;
- `io.weight` for telemetry and future validated fairness;
- `io.stat` and `io.pressure` reporting.

No operation may use `cocalc-maintenance` merely because project attribution is
inconvenient. If a project ID is authoritative, use its leaf.

Cgroup placement is necessary but not sufficient. A correctly throttled Btrfs
command can still hold a filesystem-global mutation lock or trigger metadata
work that delays unrelated projects. The admission controller, mutation-lock
priority, concurrency limit, and pressure gate are independent release
requirements; PID attribution must not be treated as closing the incident by
itself.

## Project Storage Worker Contract

### No generic privileged execution

Do not add an RPC or helper equivalent to:

```text
run this shell command as root in project X's cgroup
```

The privileged boundary accepts only allowlisted operation kinds with validated
arguments and path roots.

An initial interface may resemble:

```text
cocalc-runtime-storage project-storage-worker \
  <operation-kind> <project-id> <operation-id>
```

The operation kind maps to a fixed implementation. The operation ID resolves a
locally journaled, schema-validated request. It does not contain a shell
fragment.

### Race-free launch sequence

For every worker:

1. the project host authorizes the request and resolves current project
   placement;
2. the host-local coordinator creates or resumes the durable operation record;
3. the scheduler admits the operation;
4. the privileged launcher validates the project ID, operation ID, kind, and
   allowed paths;
5. the launcher creates or verifies the project cgroup;
6. the launcher attaches itself to the project leaf before opening project
   storage;
7. the launcher drops privileges where the operation does not require them;
8. the launcher executes the fixed worker implementation;
9. the coordinator verifies `/proc/<pid>/cgroup` and records the effective
   policy identity;
10. the worker reports progress and checkpoints through the local operation
    journal.

There must be no interval in which a worker performs project I/O before cgroup
attachment.

### Privileged Btrfs operations

Operations such as subvolume snapshot, delete, readonly transitions, and quota
changes may require privilege. Their helper must:

- remain narrowly allowlisted;
- anchor all paths under known project volumes or host-managed roots;
- reject symlinks and path traversal;
- verify the project volume identity;
- verify placement generation when applicable;
- attach to the selected cgroup before issuing Btrfs commands;
- report the cgroup path, device, start time, and completion state.

### Rustic operations

Backup and restore workers must:

- enter the project leaf before reading or writing project data;
- use the existing project-specific Rustic profile;
- avoid exposing repository credentials in process arguments or logs;
- retain the existing global backup execution limit as an outer bound;
- add scheduler admission and pressure checks rather than relying only on the
  global count;
- checkpoint enough state for safe retry after host restart.

### Process attribution verification

The coordinator treats successful process creation as incomplete until:

- `/proc/<pid>/cgroup` matches the expected leaf or maintenance cgroup;
- the expected `io.max` entries are present in `enforce` mode;
- the worker reports the same project and operation identity;
- the helper contract version is compatible.

In `enforce` mode, attribution failure fails the operation closed. It must not
fall back to executing in the project-host service cgroup.

## Operation Classification

Each storage operation is assigned one execution class.

| Operation                               | Attribution                                | Priority                |                         Initial concurrency |
| --------------------------------------- | ------------------------------------------ | ----------------------- | ------------------------------------------: |
| Project start volume/quota preparation  | project leaf or bounded control helper     | foreground lifecycle    |                        host lifecycle limit |
| Project stop finalization               | project leaf or bounded control helper     | foreground lifecycle    |                        host lifecycle limit |
| User-requested snapshot create/delete   | project leaf                               | foreground user storage |                   1 Btrfs mutation per host |
| Scheduled snapshot create/prune         | project leaf                               | background scheduled    |                   1 Btrfs mutation per host |
| User-requested backup                   | project leaf                               | foreground user storage |                        bounded backup slots |
| Scheduled backup                        | project leaf                               | background scheduled    |                        bounded backup slots |
| Project restore                         | project leaf                               | foreground recovery     |          1 restore plus storage reservation |
| Project move copy/restore               | source and destination project attribution | foreground recovery     | existing move limits plus storage admission |
| Recursive delete or snapshot path prune | project leaf                               | foreground user storage |            1 destructive worker per project |
| Rootfs cache cleanup                    | maintenance cgroup                         | host maintenance        |                                           1 |
| BEES                                    | existing BEES cgroup                       | host maintenance        |                              existing bound |
| Orphan cleanup                          | maintenance cgroup                         | host maintenance        |                                           1 |

This table is the initial policy, not an exhaustive inventory. PR 0 must produce
a complete call-site inventory and make unclassified heavy operations fail
tests.

## Storage Admission Controller

### Authority and locality

The storage admission controller runs on the project host and is authoritative
for local execution order. It does not need a round trip to the owning bay for
each scheduling decision.

The owning bay remains authoritative for:

- account and project authorization;
- placement generation;
- project I/O class;
- host policy assignment;
- project move fencing.

The host-local controller uses already-authorized operation records and local
health signals.

### Priority classes

Use four explicit priorities:

1. `lifecycle`: starts, stops, move cutovers, and required recovery;
2. `interactive`: user-requested snapshot, restore, delete, backup, and file
   operations;
3. `scheduled`: periodic snapshots and backups;
4. `scavenger`: orphan cleanup, cache cleanup, and optional compaction.

Priority affects admission, not authorization.

### Required admission inputs

Before starting each worker, evaluate:

- active project starts;
- active project stops;
- active moves and restores;
- current Btrfs mutation-lock holder and waiters;
- project-pool and maintenance-cgroup `io.pressure`;
- device and host `/proc/pressure/io`;
- recent `io.stat` deltas;
- project-host event-loop lag;
- lifecycle latency;
- memory pressure and available memory;
- Btrfs data and metadata allocation;
- storage reservations;
- active workers by operation kind and project;
- the operation's age and retry history.

The check is repeated before every operation. A decision made once at the start
of a 15-minute sweep is insufficient.

### Initial scheduler limits

The first release uses conservative limits:

- one active Btrfs mutation per writable Btrfs filesystem;
- one destructive storage operation per project;
- one restore per host unless provider testing proves a higher safe value;
- a separately bounded Rustic backup count;
- no new scheduled or scavenger operation while lifecycle work is active;
- no overlapping maintenance sweep for the same project.

The existing scheduled-maintenance parallelism of four and backup execution
limit remain inputs, but they cannot override these lower storage-admission
limits.

### Foreground arrival during background work

When a lifecycle request arrives:

1. stop admitting scheduled and scavenger work immediately;
2. mark admitted durable background workers as `yield_requested`;
3. let an indivisible Btrfs command complete;
4. require multi-step workers to checkpoint and yield before their next Btrfs
   mutation or large transfer;
5. admit lifecycle work as soon as the required lock and capacity are safe;
6. resume background work only after the recovery hysteresis passes.

Do not send an unconditional signal to a Btrfs process in the middle of a
filesystem transition.

### Starvation control

Foreground priority must not permanently disable backups on a busy host.

Use:

- operation age in queue ordering;
- per-project round-robin within a priority;
- a maximum continuous foreground admission interval before reevaluation;
- maintenance windows only as a last resort;
- explicit reporting when an operation has been deferred beyond its schedule.

Age promotion may move scheduled work ahead of other scheduled work. It may not
override emergency pressure or placement fencing.

## I/O Pressure Gate

### State machine

The maintenance gate uses:

```text
NORMAL -> CONTENDED -> RECOVERY -> NORMAL
    \          |
     \-> EMERGENCY
```

The gate is independent from the broader host-pressure project's automatic-stop
logic.

### Provisional staging thresholds

Use these only as initial staging values:

- sample every 5 seconds;
- enter `CONTENDED` after two consecutive samples with I/O PSI full `avg10`
  greater than or equal to 5%;
- enter `EMERGENCY` at I/O PSI full `avg10` greater than or equal to 10%, or
  when I/O pressure coincides with material project-host event-loop or lifecycle
  degradation;
- enter `RECOVERY` after pressure falls below the enter threshold;
- return to `NORMAL` only after at least 60 seconds with I/O PSI full `avg10`
  below 1% and no active lifecycle backlog.

These values must be adjusted from controlled staging data. They are chosen to
react well before the 13% to 26% full pressure observed during the incident.

### Actions by state

`NORMAL`:

- admit work according to priority and concurrency;
- retain static project and maintenance limits.

`CONTENDED`:

- stop new scheduled and scavenger admission;
- reduce new backup admission;
- allow already-running indivisible operations to finish;
- preserve lifecycle and interactive work if storage reservations allow it.

`EMERGENCY`:

- stop all new background admission;
- admit only lifecycle, recovery, and capacity-reclamation operations;
- tighten the aggregate maintenance cap if an adaptive policy is enabled;
- alert operators if the state persists;
- do not automatically stop projects in Phase 2.

`RECOVERY`:

- continue blocking scavenger work;
- reintroduce scheduled work one slot at a time;
- return temporary caps toward their normal values in steps.

### Btrfs metadata pressure

Btrfs metadata pressure needs directional handling:

- block snapshot creation and other growth operations when metadata headroom is
  unsafe;
- allow capacity-reclaiming deletion, but only one operation at a time;
- do not classify all snapshot deletion as safe merely because it is intended
  to free space;
- combine metadata percentage with recent allocation change, lock hold time,
  PSI, and lifecycle backlog;
- require a storage reservation for operations that can temporarily increase
  metadata use.

## Btrfs Mutation Lock Changes

The existing in-process Btrfs mutation lock remains necessary but is not
sufficient.

Extend lock state with:

- operation ID;
- project ID when attributable;
- priority;
- operation class;
- cgroup path;
- queue time;
- acquisition time;
- expected checkpointability;
- yield-requested state;
- lifecycle backlog observed while held.

Record histograms for:

- wait duration;
- hold duration;
- wait duration by priority;
- hold duration by operation kind;
- number of lifecycle operations delayed by each holder.

The scheduler must consult the lock queue before admitting another storage
worker. A background operation cannot acquire the lock ahead of an already
queued foreground operation.

In a later refactor, move lock ownership into the local durable storage
coordinator so restart recovery can explain abandoned holders. Do not make a
distributed hub lock part of the steady-state path.

## Durable Fleet Policy

### Current weakness

The bootstrap currently creates a disabled base policy if the file does not
exist. Production enforcement is supplied by host-local override files on only
some hosts.

That model is unsuitable for fleet convergence because:

- a replacement root filesystem can lose the override;
- the owning bay cannot directly compare desired and installed policy;
- canary membership is not represented as durable deployment state;
- disabled hosts are indistinguishable from hosts intentionally outside the
  rollout without external knowledge.

### Authority model

The host's owning bay stores:

- desired policy mode;
- profile ID;
- profile version;
- assignment generation;
- expected policy hash;
- rollout cohort;
- assignment reason;
- actor and audit timestamp;
- optional emergency-override expiry.

Provider-profile definitions are versioned server configuration. Per-host
assignment is durable control-plane state.

The effective assignment is included in bootstrap desired state and reconciled
on every host bootstrap/software reconciliation.

### Managed files

Use:

```text
/etc/cocalc/project-io-policy.json
/etc/cocalc/project-io-policy.override.json
/etc/cocalc/project-io-capacity.json
```

with these semantics:

- `project-io-policy.json` is a generated managed projection of the durable
  assignment;
- `project-io-capacity.json` is the generated provider/device manifest;
- `project-io-policy.override.json` is reserved for an audited emergency
  override with a reason and expiry.

Do not use an indefinite emergency override as the normal production
assignment.

The reconciler writes files atomically, applies the hierarchy, verifies
effective state, and publishes the installed generation and hash.

### Placement policy

For a host assigned to `enforce`, new placement requires:

- installed generation equals desired generation;
- installed policy hash equals desired hash;
- `policy_mode=enforce`;
- `capability=validated`;
- no current reconcile error;
- all required writable devices are represented;
- no legacy project-pool processes.

An assigned enforce host that fails these checks is quarantined from new
placement. Existing project availability is evaluated independently. The
frontend host-unavailable banner must not be driven by policy drift alone.

Hosts assigned to `disabled` remain eligible only when the placement policy for
their host class permits disabled containment. Site-owned shared GCP cohorts
will eventually require `enforce`.

### Operator interface

Add audited CLI operations, protected by fresh authentication:

```text
cocalc host io-policy status [host]
cocalc host io-policy assign <host> --profile <id> --mode <mode>
cocalc host io-policy rollout --cohort <id>
cocalc host io-policy override <host> --mode disabled --ttl <duration> --reason <text>
cocalc host io-policy clear-override <host>
cocalc host io-policy verify [host]
```

Read-only status reports desired, installed, and effective state separately.

Mutation output must show:

- affected hosts;
- policy generation and hash;
- rollout spacing;
- rollback command;
- placement effect;
- override expiry.

## Provider Profiles

### Site-owned GCP shared hosts

Continue using a versioned capacity-aware `pd-balanced` profile derived from:

- every project-writable device;
- device size;
- documented provider floors;
- aggregate pool safety factors;
- class factors.

The current profile is a valid hard-cap starting point, not a proven fairness
profile.

Roll out one disk topology and VM class at a time. Multi-device Btrfs must be a
separate cohort.

### Dedicated hosts

A dedicated host should not inherit shared-host leaf fractions without review.
Its profile may allow a single project leaf to approach the safe pool envelope
while preserving host-service reserve and bounded maintenance.

Dedicated does not mean unbounded. Backup, restore, and Btrfs maintenance can
still starve host control traffic.

### Nebius and other providers

Keep enforcement disabled until the provider has:

- trustworthy device discovery;
- a conservative capacity source;
- direct-I/O validation;
- metadata-operation validation;
- rollback validation.

Do not copy GCP model constants.

### Local and Launchpad

Expose capability and status, but do not require a cloud-specific profile.
Local installations may use an explicit static profile chosen by the operator.

## Work-Conserving Fairness Experiment

### Why `io.weight` is not enough

All checked production hosts used the `none` scheduler. Writing weights
successfully does not prove that service is divided by weight.

Production status must distinguish:

```text
disabled
hard_caps_only
weighted_unverified
weighted_verified
adaptive_caps
```

Today the enforcing hosts are `hard_caps_only`.

### `io.cost` capability

`montreal-1` exposes:

```text
/sys/fs/cgroup/io.cost.model
/sys/fs/cgroup/io.cost.qos
```

Both were unset during the production check. This proves availability, not
safety.

### Experimental sequence

Use a disposable staging GCP host with the same disk profile:

1. establish a baseline with `io.cost` disabled;
2. run equal-class contention with two and four continuously demanding
   projects;
3. run `standard:member`, `member:premium`, and
   `standard:member:premium` contention;
4. test one active project while all others are idle;
5. enable the kernel automatic model and record its learned behavior;
6. disable it and test an explicit conservative provider model;
7. repeat sequential, random, mixed, sync, buffered, and metadata workloads;
8. repeat while snapshots, backups, terminals, Jupyter, and lifecycle actions
   run;
9. reboot and verify exact configuration reconciliation;
10. remove the model and verify complete rollback.

Do not learn a production model from an opportunistic cloud-disk burst.

### `io.cost` acceptance criteria

The experiment passes only if:

- equal-weight continuously demanding projects receive shares within a
  documented tolerance;
- 100:200 and 200:400 classes demonstrate approximately proportional service;
- an idle project's unused share can be borrowed up to its class and pool
  envelope;
- control traffic and lifecycle latency do not regress materially from the
  hard-cap baseline;
- no sustained oscillation or starvation occurs;
- buffered writeback and Btrfs metadata tests do not invalidate the model;
- the model survives reboot and reconciles by profile hash;
- rollback restores the hard-cap-only baseline.

Set exact numerical tolerances before looking at the final experiment result.

### BFQ decision

Do not change production block schedulers to BFQ in Phase 2.

BFQ may be tested only on a disposable VM. A scheduler switch has a wider
performance and operational blast radius than an independently reversible
`io.cost` experiment.

## Adaptive `io.max` Controller

Build this after static attribution is complete. Run it first in signal-only
mode.

### Purpose

If `io.cost` is unavailable or unreliable, the controller approximates
work-conserving fairness by tightening caps during sustained contention and
restoring burst capacity during recovery.

It is not a replacement for static ceilings.

### Inputs

- device and pool PSI;
- project and maintenance `io.stat` deltas;
- known active worker ownership;
- lifecycle queue and latency;
- event-loop lag;
- Btrfs lock wait and hold durations;
- buffered writeback indicators where available;
- project class;
- current static and temporary caps.

### State and actions

`NORMAL`:

- static ceilings only;
- no temporary project caps.

`CONTENDED`:

- identify dominant attributed projects and maintenance workers;
- calculate weighted shares;
- lower temporary caps within the static envelope;
- leave low-demand projects untouched;
- stop new background maintenance admission.

`EMERGENCY`:

- tighten the maintenance envelope;
- tighten clearly dominant project workers;
- prefer an aggregate safety action when attribution is ambiguous;
- do not stop projects automatically.

`RECOVERY`:

- increase caps in bounded steps;
- require sustained healthy pressure;
- remove temporary caps only after hysteresis.

### Safety rules

- Never raise a cap above the static provider-profile maximum.
- Never infer an offender from one delayed `io.stat` sample.
- Do not punish a project for host-global unassigned Btrfs work.
- Audit every cap change with input metrics and expiry.
- Temporary state is reconstructed safely after restart.
- A controller failure leaves static limits in place.

## Maintenance-Specific Changes

### Scheduled snapshot and backup sweep

The current sweep:

- runs every 15 minutes by default;
- allows parallelism four by default;
- evaluates memory pressure at sweep start;
- does not have an equivalent I/O pressure gate;
- does not continuously reevaluate admission between projects.

Change it to:

1. fetch candidate metadata without admitting work;
2. enqueue one operation record per project and operation kind;
3. let the storage admission controller select work;
4. reevaluate memory and I/O pressure before each worker;
5. reevaluate after each Btrfs mutation or Rustic checkpoint;
6. stop admitting background work when lifecycle activity appears;
7. publish deferral reasons and schedule lag;
8. use one Btrfs mutation slot initially.

The sweep timer becomes a discovery mechanism, not a direct parallel executor.

### Backup execution limit

Retain the existing distributed/global backup execution limit, but combine it
with:

- host-local pressure admission;
- per-host transfer slots;
- one active scheduled backup per project;
- project cgroup attachment;
- foreground priority;
- resumable checkpoints.

The global limit protects shared backend resources. It does not protect one
host's disk by itself.

### Snapshot creation and deletion

Every snapshot command records:

- project ID;
- operation ID;
- reason: user, schedule, move, restore, or cleanup;
- cgroup;
- Btrfs lock wait and hold time;
- metadata allocation before and after;
- bytes or subvolume estimate where available;
- pressure state at admission and completion.

Snapshot pruning must not execute inline in the main event loop.

### Rootfs and cache work

Rootfs replication, extraction, and cleanup can be large and host-wide. Route
it through:

- the maintenance cgroup when host-scoped;
- the project leaf when the operation belongs to a project build;
- the same pressure gate and storage reservations;
- a distinct operation kind and concurrency limit.

## Telemetry

### Host policy telemetry

Publish:

- desired policy mode, generation, profile, and hash;
- installed policy mode, generation, profile, and hash;
- effective pool and leaf limits;
- capacity source and device identity;
- scheduler;
- `io.cost` state and model hash;
- fairness state;
- last reconcile result;
- count of project leaves, populated leaves, and mismatches;
- legacy and unattributed process counts.

### Worker attribution telemetry

Publish:

- active workers by class, priority, project, and cgroup;
- process-attribution verification failures;
- bytes, operations, and elapsed time;
- worker checkpoint age;
- queued duration and admission reason;
- cancellation and yield state;
- operation recovery count.

### Pressure telemetry

Publish:

- device, project-pool, maintenance, and bounded leaf PSI;
- pool and maintenance `io.stat` deltas;
- top attributed project deltas from a bounded sampler;
- Btrfs metadata and data allocation;
- scheduler state;
- gate state and transition reason;
- temporary cap count and values.

### Lifecycle correlation

For every slow lifecycle operation, record:

- host pressure state;
- active storage workers;
- Btrfs lock holder and wait;
- project and maintenance cgroup deltas;
- Podman phase timing;
- scheduler admission delay.

This prevents another unexplained gap between total LRO time and detailed phase
timings.

### Health semantics

Separate:

- `traffic_health`;
- `placement_eligibility`;
- `io_policy_conformance`;
- `maintenance_pressure`;
- `weighted_fairness_state`.

Only traffic health should directly drive a user-visible host-unavailable
banner.

### Alerts

Alert operators on:

- an enforce-assigned host reporting disabled or mismatched policy;
- policy reconciliation failure;
- an attributed worker outside its expected cgroup;
- a heavy storage subprocess in the project-host service cgroup;
- repeated Btrfs mutation holds over the selected threshold;
- sustained I/O PSI emergency;
- lifecycle delays correlated with maintenance;
- scheduled backup or snapshot lag beyond its service objective;
- adaptive controller oscillation;
- `io.cost` model drift.

Do not page on a single transient PSI sample.

## Security

### Privilege boundary

The privileged helper must:

- expose fixed operation kinds only;
- validate UUIDs and operation IDs;
- resolve paths from authoritative project roots;
- use file-descriptor-relative operations where possible;
- reject caller-supplied environment overrides;
- avoid shell interpretation;
- clear ambient credentials;
- record actor, project, operation, and placement generation;
- attach to the cgroup before opening project data.

### Cross-project isolation

A worker for project A must not:

- accept a path under project B;
- use project B's Rustic profile;
- attach to project B's cgroup;
- consume project B's operation record;
- survive a placement-generation mismatch.

### Multibay routing

The owning bay authorizes and fences operations. The project host executes
local storage work. Do not route bulk file or backup data through the hub.

Cross-host moves use the existing source and destination ownership routing and
must carry explicit placement generations.

### Observability privacy

Metrics may include project IDs for authorized admin diagnostics. User-facing
status must not expose another project's identity, paths, or workload.

## Feature Flags And Defaults

Add independently reversible controls:

```text
project_storage_worker_attribution
project_storage_admission_controller
project_storage_io_pressure_gate
project_storage_maintenance_cgroup
project_io_policy_durable_assignment
project_io_cost
project_io_adaptive_controller
```

Defaults:

- local development: attribution enabled where supported, policy disabled;
- staging: attribution and admission enabled after tests, hard caps enforced;
- production: cohort-driven;
- `io.cost`: disabled;
- adaptive controller: signal-only before enforcement;
- automatic I/O project stopping: disabled.

Disabling attribution must not silently restore unbounded scheduled
maintenance. The safe fallback is to disable or serialize the affected
maintenance path.

## Implementation Plan

### PR 0: inventory and contracts

- Enumerate every heavy file, Btrfs, Rustic, rootfs, copy, move, backup, restore,
  and cleanup call site.
- Assign operation kind, attribution, priority, and recovery class.
- Add a test-maintained registry of heavy operation kinds.
- Fail tests when an unclassified privileged storage helper is introduced.
- Define worker, scheduler, policy-assignment, and telemetry types.
- Capture current production and staging baselines.

Exit criterion: every known heavy storage path has an explicit target execution
class.

### PR 1: durable policy assignment

- Add owning-bay desired policy state.
- Add profile version and effective hash.
- Project policy into bootstrap desired state.
- Atomically reconcile the managed policy file.
- Reserve the override file for expiring emergency changes.
- Publish desired, installed, and effective state.
- Add audited read and mutation CLI commands.
- Keep existing host-local overrides working during migration.

Exit criterion: reprovisioning an assigned canary restores the exact effective
policy without manual SSH.

### PR 2: maintenance cgroup

- Create and reconcile `cocalc-maintenance`.
- Apply provider-profile hard limits.
- Add status, verification, and reset commands.
- Move one low-risk host-wide operation into the cgroup.
- Verify PID placement and effective limits.
- Add rollback that returns no worker to the project-host service cgroup.

Exit criterion: a direct-I/O maintenance test cannot exceed its envelope and
control traffic remains responsive.

### PR 3: project storage-worker launcher

- Implement the allowlisted privileged launcher.
- Attach before storage access.
- Add operation identity and cgroup verification.
- Add unit, security, and race tests.
- Integrate with the existing durable operation journal.
- Start with a low-risk read or bounded scan.

Exit criterion: 100% of test workers are in the expected project leaf before
their first I/O.

### PR 4: admission controller and pressure gate

- Implement priority queues and per-project fairness.
- Add lifecycle activity hooks.
- Add I/O PSI sampling and hysteresis.
- Add Btrfs lock integration.
- Add yield requests and checkpoint contracts.
- Start in decision-logging mode.
- Compare decisions against staging load tests.

Exit criterion: the controller consistently defers scheduled work before
foreground latency degrades.

### PR 5: migrate scheduled snapshots

- Convert sweep discovery into queued operation creation.
- Run snapshot create and prune in project workers.
- Enforce one Btrfs mutation per filesystem.
- Add lock and metadata telemetry.
- Reproduce the 18.9-second lock scenario.

Exit criterion: scheduled snapshot work cannot run in the project-host service
cgroup and a new project start prevents subsequent background admission.

### PR 6: migrate backups and restores

- Run Rustic backup and restore in project leaves.
- Combine global and host-local limits.
- Add checkpoints and recovery.
- Integrate storage reservations.
- Preserve repository credential isolation.

Exit criterion: backup saturation respects project and pool caps while
unrelated lifecycle and terminal operations remain responsive.

### PR 7: migrate remaining heavy operations

- Recursive delete and snapshot path pruning.
- Project copy and move pipelines.
- Archive creation and extraction.
- Rootfs project work.
- Searches and disk-usage scans above the inline threshold.
- Orphan and host cache cleanup.

Exit criterion: runtime inspection finds no heavy project-attributed child in
the project-host service cgroup.

### PR 8: complete GCP hard-cap rollout

- Converge the four existing canaries to durable assignments.
- Soak after maintenance attribution.
- Roll out to the remaining site-owned GCP cohorts.
- Require enforce/validated placement for enrolled cohorts.
- Keep provider and dedicated-host exceptions explicit.

Exit criterion: every enrolled site-owned GCP host reports the desired
generation and validated effective policy.

### PR 9: `io.cost` experiment

- Add model configuration behind an off-by-default feature.
- Build the contention harness.
- Test automatic and explicit models.
- Publish model identity and fairness measurements.
- Document provider-specific results.
- Promote only if all acceptance criteria pass.

Exit criterion: weighted fairness is either proven for a versioned profile or
explicitly rejected without affecting hard caps.

### PR 10: adaptive controller

- Implement signal-only weighted-share calculations.
- Compare calculated responsibility against controlled workloads.
- Add bounded temporary cap application.
- Add audit, expiry, recovery, and rollback.
- Keep automatic stopping disabled.

Exit criterion: sustained contention is contained without oscillation and idle
capacity returns after recovery.

## Testing

### Unit tests

- Policy merge, hash, generation, and assignment.
- Emergency override expiry.
- Cgroup target selection.
- Operation classification.
- Scheduler priority and starvation prevention.
- PSI parsing and hysteresis.
- Btrfs lock queue ordering.
- Yield and checkpoint state transitions.
- Adaptive cap calculations.
- Security path validation.

### Integration tests

- Worker attaches before opening storage.
- Worker fails closed when leaf enforcement is missing.
- Bootstrap recreates policy after root-disk replacement.
- Disabled, observe, enforce, and emergency override transitions.
- Project start arriving during scheduled maintenance.
- Project-host restart with queued and running durable operations.
- Host preemption during backup, restore, and snapshot pruning.
- Multi-device policy discovery and stale device cleanup.

### Resource stress tests

Use at least:

- two normal projects;
- one control project;
- one project from each I/O class;
- millions of small files;
- multiple snapshots;
- a Rustic repository;
- direct and buffered I/O workloads.

Test:

- sequential and random reads and writes;
- mixed I/O;
- sync and buffered writeback;
- snapshot creation and deletion;
- recursive deletion;
- backup and restore;
- project start under maintenance;
- Jupyter, terminal, file RPC, and Codex responsiveness;
- BEES overlap;
- rootfs cache work;
- high Btrfs metadata allocation.

### Failure injection

Kill or restart:

- the worker before and after cgroup attachment;
- the worker before and after a Btrfs mutation;
- project-host while the worker continues;
- project-host after recording completion but before projecting it;
- the host during Rustic upload or restore;
- the scheduler with queued yield requests;
- the bootstrap reconciler during policy replacement.

After every test, verify:

- snapshot readonly invariants;
- quota restoration;
- operation journal consistency;
- placement fencing;
- no leaked worker;
- no heavy process in the control cgroup;
- safe resumption or explicit failure.

### Security tests

- Project A cannot submit project B's operation.
- Symlink and path traversal attacks fail.
- An operation ID cannot be replayed with another kind.
- Environment and command injection fail.
- A stale placement generation fails.
- A non-admin cannot mutate host policy.
- A raw bearer or API key cannot bypass fresh-auth requirements for policy
  mutation.

### Fairness tests

Before enabling any weighted mode:

- compare observed shares to configured weights;
- verify idle borrowing;
- measure tail latency, not only throughput;
- repeat after reboot;
- repeat with buffered writeback and Btrfs metadata work;
- prove rollback.

## Rollout

### Stage 1: local and unit validation

- Land contracts, helpers, and tests.
- Verify no generic privilege boundary.
- Run package-local typechecks and tests.

### Stage 2: disposable staging host

- Use disposable projects and snapshots.
- Enable worker attribution.
- Enable maintenance cgroup.
- Run the full failure and stress matrix.
- Keep policy and controller rollback available.

### Stage 3: all staging hosts

- Converge durable policy assignment.
- Enable admission and pressure gating.
- Soak for at least 24 hours.
- Include a preemption/reprovisioning drill.

### Stage 4: existing production canaries

- Convert the four host-local enforce overrides into durable assignments.
- Deploy worker attribution and admission first.
- Verify no heavy process remains in the project-host service cgroup.
- Soak with operator coverage.
- Compare lifecycle P95, Btrfs lock duration, and PSI to baseline.

### Stage 5: site-owned GCP cohorts

- Roll out by disk topology and region.
- Space hosts.
- Keep immediate audited disable.
- Stop if lifecycle, filesystem, or backup reliability regresses.
- Require effective policy convergence before enrolling the next cohort.

### Stage 6: dedicated and non-GCP

- Define dedicated profiles separately.
- Validate each provider.
- Keep unsupported hosts explicitly disabled.

### Stage 7: fairness

- Run `io.cost` only on a staging profile.
- Canary one low-risk production host only after documented success.
- If rejected, proceed with adaptive `io.max` signal mode.

## Rollback

Rollback is layered.

### Admission rollback

- Stop admitting scheduled maintenance.
- Let indivisible Btrfs operations complete.
- Leave durable queued operations journaled.
- Keep foreground operations available where safe.

### Worker rollback

- Stop launching the affected worker kind.
- Do not fall back to unbounded inline project-host execution.
- Resume from the durable journal after a corrected deployment.

### Adaptive rollback

- Disable temporary cap calculation and application.
- Clear every temporary cap.
- Restore the static profile.
- Verify effective values.

### `io.cost` rollback

- Disable the CoCalc-managed model and QoS settings.
- Verify weights are reported as unverified.
- Preserve static `io.max`.

### Hard-policy rollback

- Assign `observe` or `disabled` through an audited, expiring override.
- Reset pool and leaf device limits to `max`.
- Preserve CPU, memory, PID, quota, BEES, and worker-attribution controls.
- Verify effective state on every affected host.

### Fleet rollback

- Stop the rollout operation.
- Revert only the current cohort.
- Keep prior validated cohorts unchanged unless evidence implicates the shared
  policy.
- Record the reason, actor, versions, and affected hosts.

## Acceptance Criteria

Phase 2 hard containment is complete when:

1. every site-owned GCP host enrolled in the policy reports the desired
   generation and `enforce/validated`;
2. every heavy project-attributed worker is in its project leaf before I/O;
3. every host-wide storage worker is in a bounded maintenance cgroup;
4. no heavy child process runs in the project-host service cgroup;
5. the aggregate project pool and every project leaf pass direct-I/O limit
   tests;
6. scheduled maintenance yields admission to lifecycle work;
7. a repeat of the July 29 maintenance scenario does not create comparable
   unrelated-project start delays;
8. Btrfs lock wait and hold time are fully represented in lifecycle and storage
   telemetry;
9. policy survives host reprovisioning without manual SSH;
10. unsupported providers remain explicitly disabled rather than silently
    misconfigured;
11. rollback is tested end to end;
12. no user-visible host-down banner is caused solely by I/O policy
    conformance.

Weighted fairness is complete only when:

1. the active provider profile passes controlled share tests;
2. idle capacity is measurably borrowable;
3. control and lifecycle latency do not regress;
4. effective model identity is reported;
5. reboot and rollback are proven.

If weighted fairness does not pass, Phase 2 may still ship as
`hard_caps_only` plus the adaptive controller in signal mode.

## Open Decisions

These require staging evidence:

1. Exact maintenance-cgroup BPS and IOPS fractions.
2. Exact I/O PSI enter, emergency, and recovery thresholds.
3. Whether one Rustic transfer per host is too conservative.
4. Whether user-requested backup should outrank scheduled snapshot pruning.
5. Whether a capacity-reclaiming snapshot delete may run during lifecycle
   pressure.
6. Whether nested runtime and storage cgroups are needed later.
7. Whether `io.cost` automatic or explicit modeling is stable on GCP
   `pd-balanced`.
8. Dedicated-host leaf and maintenance fractions.
9. Provider-specific behavior for Nebius and multi-device Btrfs.
10. The lock-hold and schedule-lag thresholds that should page rather than
    notify.

Do not resolve these by choosing values after observing a failed final test.
Commit the thresholds and expected outcomes before the decisive experiment.

## Recommended Immediate Ordering

1. Land durable policy assignment and convert the four current canaries.
2. Add the maintenance cgroup and project-worker launch contract.
3. Add lifecycle-aware admission and an I/O PSI gate.
4. Migrate scheduled snapshot deletion and creation first.
5. Migrate scheduled Rustic backups and restore paths.
6. Reproduce and close the `montreal-1` incident scenario in staging.
7. Roll hard containment across site-owned GCP cohorts.
8. Complete the remaining worker inventory.
9. Run the `io.cost` experiment.
10. Implement adaptive control only after attribution telemetry is trustworthy.

The first production benefit should come from stopping maintenance bypass and
prioritizing foreground work. True work-conserving fairness is valuable, but it
must not delay that correction.
