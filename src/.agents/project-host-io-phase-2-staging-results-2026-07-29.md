# Project Host I/O Phase 2 Staging Results

Date: 2026-07-29

Status: staging foundation deployed and validated; no production deployment
performed or approved.

## Scope

This implementation covers the first safe subset of
[`project-host-io-phase-2-plan-2026-07-29.md`](./project-host-io-phase-2-plan-2026-07-29.md):

- typed storage-operation classification and priority;
- lifecycle-first Btrfs mutation queue ordering;
- bounded host-wide maintenance execution;
- host-local storage admission with hysteresis;
- observe-mode decision logging and counters;
- operation, project, priority, and cgroup attribution;
- operator-visible containment and admission telemetry.

It deliberately does not claim to complete the operating-system-like parts of
the full plan. Durable per-operation workers, operation journaling and leases,
all project-attributed leaf placement, durable policy assignment, weighted
fairness, adaptive control, and the complete failure-injection matrix remain
future work.

## Changes

### Operation registry and priority

The project host now has a typed registry for lifecycle, interactive,
scheduled, and scavenger storage operations. Btrfs mutation context is carried
with `AsyncLocalStorage`, including:

- operation ID;
- operation kind;
- project ID;
- priority;
- cgroup path;
- checkpointability.

The in-process Btrfs mutation queue orders waiters:

1. lifecycle;
2. interactive;
3. scheduled;
4. scavenger.

Ordering remains FIFO within a priority class.

### Maintenance isolation

Bootstrap creates `/sys/fs/cgroup/cocalc-maintenance` with:

- `cpu.max=200000 100000`;
- `cpu.weight=10`;
- `io.weight=10`;
- `memory.high=4 GiB`;
- `memory.max=8 GiB`;
- swap disabled;
- `pids.max=256`;
- per-device `io.max` equal to 10% of the capacity-derived project-pool
  envelope.

Only narrow root helper commands attach processes to this cgroup:

- `btrfs-maintenance`;
- `project-rustic-backup-maintenance`.

Scheduled and scavenger Btrfs operations and scheduled Rustic backups use
these helpers. Interactive operations retain their existing path.

### Admission

The storage admission controller samples every five seconds and combines:

- host I/O PSI;
- project-pool I/O PSI;
- active project starts and stops;
- Btrfs mutation lock holders and waiters;
- active operation counts by priority.

Its states are `normal`, `contended`, `emergency`, and `recovery`. Defaults are:

- enter `contended` after two samples at 5% full I/O PSI;
- enter `emergency` at 10%;
- require pressure below 1% and no lifecycle activity for 60 seconds before
  returning from recovery to normal.

Staging is intentionally in `observe` mode. Scheduled or scavenger operations
that enforcement would defer are admitted, counted in
`observed_deferral_total`, and logged with the reason. Lifecycle and
interactive work remain admitted.

### Telemetry

Project-host heartbeats publish:

- effective leaf I/O policy and capability;
- maintenance limits, pressure, and process count;
- storage admission state and sampled pressure;
- active operations by priority;
- Btrfs lock holders and waiters;
- admitted, deferred, and observed-deferral counters;
- the last admission decision.

The hub host-row normalizer initially dropped these nested fields. Commit
`606f9f975c` adds validation and preserves `io_containment` and
`storage_admission` through the standard host metrics API.

## Commits

- `993424af31bf` - `project-host/io: add priority admission and maintenance isolation`
- `47128cd82a7a` - `server/bootstrap: preserve helper schema on helpers-only rollout`
- `606f9f975c` - `server/hosts: expose project-host I/O control telemetry`

The helper-schema follow-up was found during the first staging rollout. A
helpers-only artifact must not advance the schema marker owned by the root
control wrapper, which that rollout intentionally does not replace. The
bootstrap artifact hash already tracks the privileged helper content.

## Validation

### Automated

Passed before staging deployment:

- file-server operation cache and utility tests: 2 suites, 6 tests;
- project-host test suite: 104 suites, 645 tests;
- bootstrap Python tests: 69 tests;
- server host-normalization tests: 23 tests;
- TypeScript build checks for file-server, project-host, conat, and server;
- repository formatting and `git diff --check`.

The admission tests cover disabled, observe, enforce, emergency, recovery,
lifecycle priority, and missing-pressure behavior. Maintenance tests cover
operation classification, deferral, attribution, and cgroup helper selection.

### Staging artifacts

Bootstrap artifact:

```text
20260729T183251Z-47128cd8-io-phase2-47128cd8
sha256 e4a46af25c674db907b4c2215a8bbd4a6dbe526ce42a6e29ca9e6d0b9ed2e707
```

Project-host artifact:

```text
20260729T183021Z-993424af-io-phase2-993424af
sha256 6f631077894385403f39ced7532db2d6cc6b06eb5b35139c5a5beca5d757efc3
```

Hub artifact:

```text
20260729T184722Z-606f9f97-io-phase2-606f9f97
sha256 ee97afa38d8ef08eb85c5e18a85de0a323871a64f3798edcabe24eca3ccab44d
```

### Staging deployment

Bootstrap helpers-only deployment:

```text
20260729T183258Z-20260729T183251Z-47128cd8-io-phase2-47128cd8
```

Both staging hosts reconciled successfully without a project-host daemon
restart.

Project-host rollout campaign:

```text
81d858ef-dbc9-48f5-9d4b-a8161cffd60b
```

`host2` was the canary, with 60 seconds of healthy stabilization. `host`
followed with 30 seconds. The project-host smoke test passed.

Hub deployment:

```text
20260729T184856Z-20260729T184722Z-606f9f97-io-phase2-606f9f97
```

All four staging hub workers were drained, restarted, verified healthy, and
undrained one at a time. Final bay health was:

```json
{
  "ok": true,
  "postgres_ok": true,
  "persist_ok": true,
  "router_ok": true,
  "frontdoor_ok": true,
  "healthy_workers": 4,
  "min_healthy_workers": 1
}
```

Hub smoke tested the homepage, static shell, favicon, and all four worker paths
to `host2`.

Both staging hosts subsequently reported:

- host status `running`;
- bootstrap lifecycle `in_sync`;
- bootstrap drift count 0;
- project-host artifact exactly matching the artifact above;
- I/O policy `enforce`;
- I/O capability `validated`;
- admission mode `observe`;
- no legacy project processes outside their expected cgroups.

## Controlled Stress

Tests used staging `host2`
(`37782b66-190d-41c3-a7e5-f5662e34cd4a`) and disposable project
`a863f349-472b-4a06-a4ec-003826fc5e28`. Temporary files were removed after
each run.

`host2` has separate data and scratch devices. The maintenance write cap on
each device is 2,293,760 bytes/s, approximately 2.19 MiB/s.

### Direct-write cap

A 64 MiB direct write outside the maintenance cgroup completed in 0.24
seconds, approximately 267 MiB/s.

The same write after attaching the shell to the maintenance cgroup completed
in 29.26 seconds. The cgroup accounted exactly 67,108,864 write bytes. This
matches the configured 2.19 MiB/s cap.

A second 128 MiB direct write completed in 58.52 seconds, again matching the
cap.

During the first capped write:

- maintenance I/O full PSI reached 81.36%;
- host-wide full I/O PSI remained 0%;
- the maintenance cgroup contained three processes;
- a project command completed in 0.895 seconds;
- the public project-host health route remained healthy and returned the
  correct `host_id`.

During the longer capped write:

- maintenance I/O full PSI reached 83.91%;
- host-wide full I/O PSI was 0.39%;
- the disposable project stopped in 1.46 seconds;
- the disposable project restarted successfully in 3.86 seconds;
- 20 of 20 public-route probes succeeded;
- public-route latency was 78 ms mean and 201 ms maximum.

After completion the maintenance process count returned to zero and the
temporary files were absent.

## Natural Scheduled Sweep

The project host's ordinary snapshot and backup sweep began after its
configured 15-minute initial delay. This validated the real application path,
not only a manually attached process.

At peak, telemetry reported:

- pressure state `emergency`;
- four active scheduled operations;
- one Btrfs mutation lock holder;
- two Btrfs mutation waiters;
- `admitted_total=14`;
- `observed_deferral_total=14`;
- last decision `scheduled_backup`, `would_defer=true`, reason
  `io_pressure_emergency`;
- project-pool full I/O PSI 0%.

The maintenance log contains corresponding
`scheduled project storage operation would be deferred` records. Because the
controller is in observe mode, the sweep completed rather than being blocked.
No snapshot or backup maintenance errors were found.

During this real sweep:

- a project command completed in 0.843 seconds;
- 20 of 20 public-route probes succeeded;
- public-route latency was 53 ms mean and 212 ms maximum.

After the sweep:

- active operation counts returned to zero;
- Btrfs lock holders and waiters returned to zero;
- maintenance process count returned to zero;
- the state machine entered recovery and began its 60-second low-pressure
  hysteresis.

## Findings

1. The aggregate maintenance cgroup prevents scheduled work from consuming
   burst disk capacity needed by project lifecycle and interactive traffic.
2. The operation context and priority queue expose real Btrfs contention:
   scheduled work was visible as one holder and two waiters.
3. The admission controller correctly classified real scheduled work as
   deferrable under pressure while leaving lifecycle and interactive work
   responsive.
4. Observe mode is important for this first staging pass. It produced decision
   evidence without risking missed snapshots or backups.
5. The host metrics API required the normalization fix in `606f9f975c`;
   project-host telemetry alone was insufficient for operator visibility.
6. Host-wide PSI includes time that maintenance spends throttled. This is
   useful for admission, but dashboards must present maintenance PSI and
   project-pool PSI together so a deliberately throttled worker is not mistaken
   for project-pool saturation.

## Remaining Gates

Before enabling admission enforcement on all staging hosts:

- add a durable, audited per-host or per-cohort admission-mode assignment;
- add an operator-visible rollback that survives restart and reprovisioning;
- soak observe mode for at least 24 hours;
- confirm scheduled snapshot and backup freshness remains within policy;
- define alerting that distinguishes maintenance throttling from user-pool
  pressure;
- run a canary enforce test with an intentionally pressured maintenance sweep;
- verify recovery reaches normal without oscillation.

Before any production proposal:

- complete the staging gates above;
- run preemption and project-host restart tests;
- test failure cleanup around Btrfs and Rustic helpers;
- test larger metadata-heavy and small-file workloads;
- verify Jupyter, terminal, files, browser apps, and Codex during maintenance;
- review all commits and staging results;
- obtain explicit production approval.

No production command, deployment, or mutation was performed during this
work.
