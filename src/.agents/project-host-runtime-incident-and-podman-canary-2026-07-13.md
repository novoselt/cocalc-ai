# Project-host runtime incident and Podman canary plan (2026-07-13)

## Executive summary

Two production project hosts accepted healthy control-plane heartbeats while their
project runtime was unusable:

- `western-europe-1`, host `dab25958-64df-4bea-803b-77319d7839f6`
- `eastern-europe-1`, host `7b1fa6e1-032d-4e90-bd20-00568c67d5d0`

On the western host, a GCP Spot termination was followed by an automatic boot.
The host registered and the hub started project recovery, but Podman, systemd
login-session creation, and cgroup PID attachment subsequently became
unresponsive or invalid. A hard VM restart restored service. The eastern host
later exhibited the same runtime symptoms after a project-host software rollout,
without a VM reboot, and also recovered after a hard restart.

This is not yet a complete low-level root cause. However, timeline correlation
now makes the July 13 per-project cgroup rollout the leading regression. CoCalc
had exercised the prior rootless Podman model for months, including roughly a
month in production, without this failure. The new code began moving pasta,
Podman launcher, conmon, and container processes into a hierarchical root-owned
cgroup on the same day as both incidents. The evidence points to an interaction
between that new process migration and rootless Podman/systemd lifecycle, not to
ordinary CPU pressure or a previously recurring independent Podman failure.

The immediate code changes fail closed, preserve diagnostics, and prevent a
single unhealthy runtime from causing a recovery storm. They do not claim to
eliminate the underlying runtime failure. Subsequent staging work established a
healthy reverted baseline; the remaining experiments must continue to change
one variable at a time.

## Current status (2026-07-14)

The immediate production containment work is complete:

- `6201405c0c` added the functional runtime-health gate, bounded diagnostics,
  alerts, recovery canaries, and stale project-start LRO cancellation.
- `6932477e26` removed the unsafe hierarchical per-project PID-migration path
  and restored the previously stable aggregate cgroup containment model.
- `425d1eac4f` fixed an independent compatibility-library publication race.
  Project starts had been copying the shared `libatomic.so.1` directly over a
  live file. Concurrent starts could therefore expose a partially written ELF
  library to unrelated running Node processes, causing synchronized `SIGBUS`
  and `SIGSEGV` failures. The library is now published atomically.

All 15 registered production hosts received the compatibility-library fix. At
the latest fleet audit, all 11 active project hosts were running, had fresh
heartbeats, reported healthy runtime probes, and had no host-specific
project-host software overrides. Host placement now excludes a host whose
Podman data plane is unhealthy even if its Node heartbeat remains fresh.

The disposable staging canary also established a useful baseline:

- A `t2d-standard-32` host with adequate disk admitted 50 projects.
- An explicit 20-project start burst completed in approximately 5.5 seconds.
- An explicit 50-project start burst completed in approximately 11.5 seconds.
- After a controlled VM reboot, runtime readiness returned approximately 48
  seconds after boot and all 50 projects started within a 9.7-second window.
- Before the atomic library fix, concurrent project churn reproduced widespread
  Node crashes both inside projects and in unrelated CLI processes. The same
  workload no longer reproduced those crashes after the fix.

This establishes that the reverted runtime can recover projects quickly in
parallel. It does not yet satisfy the long-duration promotion gate below.

The next hardening layer was deployed to staging only on 2026-07-14:

- the placement contract now fails closed when runtime-health metadata is
  missing instead of treating an old or incomplete heartbeat as healthy;
- each host advertises support for a synthetic project lifecycle probe;
- the owning bay periodically creates a host-local temporary project, starts
  its real container, executes inside it, writes and reads a mounted file, then
  stops it and deletes its local volume without creating a central project;
- failed synthetic probes quarantine the host until a later probe passes;
- forensic capture publishes requested, completed, and failed timestamps in
  runtime-health metadata instead of existing only as an unstructured log;
- every host process-session transition proactively cancels all active
  project-start and restore LROs that predate the new session;
- a fresh-heartbeat cloud host with repeated runtime failures can be hard
  rebooted only after forensic capture completes, with a 15-minute per-host
  cooldown, at most two attempts in six hours, and at most one fleet-wide
  automatic reboot in ten minutes;
- every synthetic failure, automatic reboot, and exhausted recovery budget
  produces a deduplicated operator alert.

The first staging lifecycle probes exposed a real configuration bug rather than
an artificial failure: project start used CoCalc's persistent Podman runtime
directory, while container exec invoked Podman without the shared environment
and therefore searched under `/run/user/2000`. Both canary hosts were correctly
quarantined, completed forensic capture, and retried. One host received the
bounded automatic hard reboot; the fleet-wide spacing gate prevented the second
host from rebooting concurrently. `224ad4323c` fixed sandbox exec to use the
same runtime environment and suppressed central provisioned-state reporting for
synthetic volumes.

After that fix, both staging hosts passed complete create/start/exec/write/read/
stop/delete probes in about 1.2 seconds. The generated projects left no central
PostgreSQL project row, host-local SQLite project row, Podman container, or
Btrfs home/scratch subvolume. Both hosts returned to runtime `ready`, and a
read-only audit found no active project-start LRO predating either current host
session.

The next scheduled 30-minute cycle passed again on both hosts on 2026-07-14 at
01:32 UTC. The lifecycle durations were 0.83 and 0.67 seconds, controller
durations were 1.25 and 1.00 seconds, and both newly generated project IDs again
left no central project row. The rebooted host's automatic-recovery metadata
changed from `scheduled` to `recovered` and retained the completed work ID,
prior boot ID, attempt history, and cooldown.

The failure run also verified delivery of synthetic-failure and automatic-
reboot admin alerts. It revealed that random temporary project identifiers in
the error text defeated exact-body message deduplication and produced repeated
alerts. `bd2b7002a7` persists a per-host alert timestamp, limits continuous
failure alerts to one per 15 minutes, and marks a scheduled reboot as recovered
after a successful probe on the new boot without discarding its rolling attempt
history or cooldown.

Staging artifacts currently under test are:

- project-host
  `20260714T042331Z-8fcbe4ad-explicit-component-restart`, containing the
  synthetic-probe support, forensic log retention, durable app supervisor, and
  explicit operator restart fix;
- hub controller commits `bd2b7002a7`, `a3c5a0582b`, `892520ca00`, and
  `43ef81e0c9`, with synthetic probes now due after every project-host process
  session as well as every boot and normal interval.

No synthetic-probe or automatic-reboot hardening code from this phase has been
deployed to production. Staging project-host targets currently use explicit
host overrides because the canary artifact has not been promoted to the fleet
default. Remove those overrides only after an intentional global promotion.

### Lite4b synthetic-process exit (2026-07-14)

The first lifecycle probe on Lite4b host `host1`
(`c2c1bb5b-d5fb-4a06-8904-4549f4089ac2`) exposed a separate failure. The
synthetic Podman create/start/exec/stop/remove sequence completed in about one
second, but the project-host process handling the RPC disappeared immediately
after container removal and before Btrfs volume cleanup. The host-agent found
the stale PID and started a replacement process. The original controller call
then remained pending until its 15-minute RPC timeout, quarantined the host, and
sent an alert. The retry passed in under two seconds and automatically cleared
the quarantine; no automatic VM reboot occurred.

The evidence excludes host memory pressure and a kernel OOM kill. The host had
about 7.3 GB available after the process exit, modest load, and no OOM or
segfault record in the kernel journal. The project-host process maps the system
`libatomic.so.1`, so this event does not match the previously fixed shared
compatibility-library publication race. The exact native exit remains unknown:
core dumps were disabled and project-host startup deleted the previous daemon
log before the replacement process started.

The follow-up hardening therefore:

- reduces the default synthetic RPC timeout from 15 minutes to 2 minutes;
- schedules a new lifecycle probe after every project-host process-session
  transition, not only after a VM boot or the normal 30-minute interval;
- includes the deployment hostname in synthetic-failure alert subjects and
  bodies, avoiding confusion between Lite4b, staging, and production;
- rotates up to five prior project-host logs under `log-history/` instead of
  deleting the previous log on every restart; and
- records the dead PID in stale-process supervision events.

This makes the next occurrence both faster to detect and materially more
diagnosable. It does not claim that the unexplained process exit itself has been
fixed.

### Durable app-exit evidence and recovery test (2026-07-14)

The first exit-observer implementation attached a Node `ChildProcess` listener
in whichever process launched project-host. A controlled `SIGSEGV` test showed
that this was not durable: during an artifact transition, the old host-agent
launched the new app and was then replaced by the new host-agent. The app
survived, but the in-memory listener disappeared with its former parent.

Commit `35af3a54db` therefore added a small persistent app supervisor to every
project-host artifact. The daemon PID now identifies the supervisor, while a
separate `project-host-app.pid` identifies the actual app child. The supervisor:

- remains the app's parent independently of host-agent replacement;
- records the actual child exit code or signal in `supervision-events.jsonl`;
- forwards normal shutdown signals and records which signal it forwarded;
- attributes active project start/stop heartbeats to the durable daemon PID;
  and
- exits after the app so the existing host-agent stale-PID recovery path starts
  a fresh supervisor and app.

Commit `8fcbe4adbb` also fixed operator component rollouts. The prior delayed
command ran `daemon ensure`, which did nothing when the current daemon was
healthy; the rollout RPC could therefore report success without changing the
process. It now runs the explicit `daemon restart-project-host` action.

Both fixes were deployed only to staging. On staging host `host2`, the verified
process tree was supervisor PID `451721`, app PID `451729`, and independent
host-agent PID `451728`. A controlled `SIGSEGV` sent only to the app produced:

- a durable `process_exit` event naming app PID `451729`, supervisor PID
  `451721`, and signal `SIGSEGV` at `04:25:07` UTC;
- stale-supervisor detection at `04:25:11`;
- replacement supervisor start at `04:25:12`;
- a ready health endpoint with app activity correctly attributed to the new
  supervisor; and
- a full synthetic create/start/exec/write/read/stop/delete probe that passed
  in 740 ms (1.106 seconds including controller work) for the new process
  session.

A subsequent explicit component rollout changed the supervisor PID from
`452707` to `454936`. The old supervisor recorded child exit code 0 with
`forwarded_signal=SIGTERM`, and the replacement became healthy. This validates
both crash recovery and the normal operator restart path. Core dumps remain
disabled; the durable signal evidence narrows future failures, but bounded
staging core capture is still needed for native stack diagnosis.

## Incident timeline

All times are UTC on 2026-07-13.

### Western Europe

- `19:37:34`: prior VM boot began.
- `21:03:35`: GCP terminated the Spot VM.
- `21:03:53`: automatic provider start completed.
- `21:03:58`: new Linux boot began.
- Approximately `21:04:45`: the project-host heartbeat returned and the hub
  considered the host recovered.
- During that boot, project starts and host-local commands became unusable.
  Authentication to SSH succeeded, but opening a session hung. systemd-logind
  timed out creating session scopes. The watchdog repeatedly encountered
  `EINVAL` while attaching processes to project cgroups. Podman commands hung.
- `21:20:18`: that boot ended.
- `21:21:42`: a manual soft restart boot began; it remained unhealthy.
- `21:27:36`: that boot ended.
- `21:28:27`: a manual hard restart boot began; service recovered.

The affected legacy project was additionally blocked by a project-start LRO
created before the successful host boot. The LRO remained active because restore
starts had a three-hour orphan grace period.

### Eastern Europe

The fleet audit found a second heartbeat-fresh host where:

- `rootctl doctor` timed out;
- SSH authentication succeeded but session creation hung;
- project-host logs showed `podman ps` being killed;
- cgroup attachment produced the same `EINVAL` pattern.

This host had not just rebooted. The project-host process session had changed
during a software rollout. A hard restart restored service, and a user project
subsequently started and executed successfully.

This second incident is important: the failure class is associated with runtime
or process-session transitions, not exclusively with GCP Spot VM startup.

## Regression correlation

The relevant changes all landed on 2026-07-13:

- `4a93067b05` at 00:05 UTC: attach rootless pasta networking helpers to the
  project pool;
- `c2b9a26cdd` at 00:36 UTC: change pasta cgroup reconciliation;
- `6862a8a1ee` at 01:28 UTC: convert the aggregate pool into a hierarchy, create
  per-project leaves, and launch Podman from inside the leaf;
- `4a37e34369` at 10:59 UTC: add per-project I/O controller delegation;
- `476de72916` at 12:03 UTC: bound rootless user-namespace probes.

The western failure began after the 21:03 UTC Spot restart. The eastern failure
appeared after a project-host software transition on the same code. This is a
strong temporal and mechanistic correlation. It is not mathematical proof of
the exact kernel/systemd failure, but it is sufficient to treat the new
hierarchical/pasta cgroup path as unsafe for production until isolated testing
disproves it.

Project-start concurrency had also just been deliberately raised after staging
showed that a limit of two made a 20-project burst take about a minute instead of
several seconds. That performance change is valid for a healthy host, but it
increased the number of concurrent cgroup hierarchy and PID-migration operations
during the first production recovery. It is therefore a likely amplifier rather
than a reason to return normal user starts to permanently low concurrency.

The most suspicious mechanism is concurrent cgroup-v2 hierarchy mutation and
PID migration. The code enables child controllers only after moving internal
processes to a legacy leaf, launches the Podman client inside a project leaf,
and later discovers and moves conmon, container, and pasta process trees. During
the incidents, those writes returned `EINVAL` while systemd session scopes and
Podman commands also stalled. A process-exit/PID-discovery race, violation of a
cgroup-v2 hierarchy constraint, or conflict with systemd's ownership of related
processes could therefore wedge the broader user runtime.

## What failed

### Detection

The project-host registration and heartbeat proved that the Node process and
Conat connection were alive. They did not prove that Podman could list or start
containers. The hub therefore advertised the host as online and eligible even
when its data plane was broken.

The existing `rootctl doctor` checked `podman info`, which is not strong enough.
The bad state could pass or repair `podman info` and later hang on `podman ps`.

### Recovery fan-out

One second after host registration, restart recovery could start up to 32
projects concurrently. The automatic default was CPU/memory scaled, so a
16-vCPU host selected eight concurrent starts. There was no functional runtime
readiness gate between starts. This can amplify a partially initialized or
degraded rootless runtime into a host-wide failure.

### Runtime startup

The daemon recognized a narrow set of stale Podman pause/user-namespace errors
and ran `podman system migrate`, but a generic timeout or failure was allowed to
continue. Thus the project-host process could register even though its runtime
preflight had not succeeded.

### Stale operations

Project-start LRO cleanup was based on elapsed time. It did not compare the LRO
creation time with the current host process's `host_session_started_at`. A
restore start from a dead host process could therefore block new work for hours.

## Relevant runtime configuration

Production hosts currently use:

- Ubuntu with Linux `6.17.0-1020-gcp`;
- rootless Podman `4.9.3` and crun `1.14.1`;
- cgroup v2 with Podman forced to `cgroupfs`, rather than Podman's `systemd`
  default;
- CNI networking;
- graph and run roots under `/mnt/cocalc/data`;
- a persistent custom `XDG_RUNTIME_DIR` under `/mnt/cocalc/data/tmp`, rather
  than `/run/user/2000`;
- systemd linger for the project-host user;
- a root-owned `/sys/fs/cgroup/cocalc-project-pool` hierarchy.

The reverted production implementation uses the older flat aggregate project
cgroup together with Podman's native per-container limits and the host pressure
controller. It no longer moves Podman, conmon, container, or pasta PIDs into
per-project child cgroups. The July 13 hierarchical implementation did those
migrations and remains disabled pending isolated staging tests.

Podman documents that rootless operation uses a pause process to preserve the
user namespace and that `podman system migrate` stops that process when runtime
state must be migrated. Podman's default cgroup manager is `systemd`, and its
troubleshooting documentation expects rootless cgroup-v2 operation to have a
valid systemd user session. Changing cgroup managers can invalidate existing
containers, so this must be tested on a newly provisioned host rather than
changed in place.

References:

- [Podman system migrate](https://docs.podman.io/en/stable/markdown/podman-system-migrate.1.html)
- [Podman global cgroup-manager configuration](https://docs.podman.io/en/latest/markdown/podman.1.html)
- [Podman installation and runtime requirements](https://podman.io/docs/installation)
- [Current stable Podman version](https://podman.io/)
- [Podman rootless troubleshooting](https://github.com/containers/podman/blob/main/troubleshooting.md)
- [Podman issue 16641: invalid internal status after reboot](https://github.com/containers/podman/issues/16641)
- [Current Podman releases](https://github.com/containers/podman/releases)
- [Docker rootless cgroup requirements](https://docs.docker.com/engine/security/rootless/tips/)

## Immediate safeguards implemented

1. Project-host registration reports a bounded functional `podman ps -a` probe,
   not just process liveness.
2. Hosts with fresh heartbeats but failed runtime probes are marked degraded,
   excluded from placement, and excluded from restart recovery.
3. Create/start/stop/status control calls fail closed while runtime readiness is
   false.
4. The daemon refuses to start the project-host after an unrecognized Podman
   preflight timeout or failure.
5. After two consecutive probe failures, project-host captures a rate-limited,
   bounded forensic snapshot: debug Podman commands, process wait channels,
   systemd user state, login-session state, and project cgroup state.
6. Operators receive a deduplicated alert after repeated runtime failures.
7. Automatic restart recovery begins with two canary starts. After two projects
   start successfully it opens the gate to the existing CPU/memory-derived
   concurrency, up to 32, with short launch spacing. This preserves fast bulk
   recovery without applying maximum pressure to an unproven runtime.
8. Runtime readiness is checked before and between recovery starts. Recovery is
   paused, not converted into misleading `opened` project state, if the runtime
   degrades.
9. `rootctl doctor` now requires both `podman info` and `podman ps`.
10. Cgroup attachment failures remain visible but are rate-limited instead of
    flooding logs.
11. Project-start LROs created before the current host process session are
    canceled immediately, including restore LROs. The new host-session sweep
    does this proactively for every assigned project with an active start LRO.
12. Full synthetic start/exec/file-write/stop probes and bounded automatic hard
    reboot recovery are implemented but remain staging-only until deliberate
    failure tests verify quarantine, forensic preservation, alerting, recovery,
    and the fleet circuit breaker.

## Is Podman the wrong runtime?

There is not enough evidence to justify an immediate migration.

Rootless Docker would still depend on a systemd user session and cgroup v2 for
resource controls, so it may preserve the same failure class. Rootful Docker or
containerd would remove the rootless pause/user-namespace lifecycle, but would
introduce a privileged daemon and require a security and project-runner redesign.
Incus/LXC would be a still larger change from application containers to system
containers.

The current leading concern is not simply "Podman". It is the newly deployed
non-default cgroup integration around Podman. We should retain the option to
upgrade or replace the runtime, but must not use an engine upgrade to mask the
cgroup regression: first return production to the known-stable aggregate model,
then make comparative changes in staging.

## Immediate production recommendation

1. **Complete:** roll back the July 13 hierarchical per-project cgroup and pasta
   PID-migration path.
2. **Complete:** retain Podman's native per-container memory, CPU, and PID
   limits, the older aggregate `cocalc-project-pool` cap, and the host pressure
   controller. This is not a return to uncontained projects.
3. **Complete:** deploy runtime readiness, diagnostics, alerting, recovery
   throttling, and stale-LRO fixes independently.
4. **Complete:** deploy the atomic compatibility-library publication fix to the
   fleet and remove temporary host-specific software overrides.
5. **Staging-validated:** synthetic runtime probes, automated quarantine,
   durable forensic completion state, cleanup, retry, and alert delivery.
6. **Partially staging-validated:** bounded automatic hard-reboot recovery ran
   once after forensic capture and the fleet gate blocked a concurrent second
   reboot. Cooldown and rolling-budget exhaustion remain covered by tests but
   require deliberate multi-reboot staging fault injection before production.

Do not combine this production stabilization with a Podman upgrade, a switch to
systemd cgroups, or a networking-backend change. Those remain separate staging
experiments.

## Podman upgrade program

Podman should be upgraded, but the production health and recovery controls come
first. The current incidents do not show that Podman itself is the wrong
runtime: the two identified regressions were CoCalc's nonstandard cgroup PID
migration and a shared-library publication race. Nevertheless, Podman 4.9.3 is
old enough that remaining indefinitely on the Ubuntu package would forfeit
relevant rootless lifecycle, reboot, storage, and security fixes.

The upgrade program is:

1. Validate the implemented synthetic host probes, placement quarantine,
   forensic capture, alerts, stale-LRO cleanup, and bounded automatic reboot
   recovery on staging before any production rollout.
2. Build a reproducible and pinned runtime bundle containing Podman and matching
   versions of crun, conmon, containers/storage, containers/common, and related
   configuration. Do not upgrade only the Podman binary. In particular, current
   upstream Podman requires at least crun `1.14.3`, which is newer than
   production's `1.14.1`.
3. Test the latest Podman 5.8.x patch release on fresh staging hosts while
   retaining CNI, forced `cgroupfs`, the custom runtime directory, SQLite, and
   the flat aggregate cgroup. Podman 5.8 is the controlled bridge because it can
   migrate legacy BoltDB state before Podman 6 removes BoltDB support.
4. Test Podman 6.0.1 as a separate staging variant. Verify the configured
   database backend and all persistent storage metadata before allowing a host
   to serve projects.
5. Require at least 200 automated VM/process interruption cycles and 1,000
   project start/stop cycles, with the assertions below, before promoting a
   runtime bundle.
6. Roll out the selected bundle first when provisioning replacement Spot hosts.
   Do not silently change the runtime version merely because an existing VM
   rebooted.

### Spot replacement and reboot policy

Spot churn is a good deployment mechanism only when it creates a clean runtime
host. Project data is durable and separate, but Podman's graph root, run root,
container database, pause/user-namespace state, network state, and OCI runtime
metadata may persist across an ordinary reboot on the same attached disk.
Installing a new major Podman stack during that reboot is therefore still an
in-place upgrade.

Each host boot must use a versioned runtime-state contract:

- A freshly provisioned host with no Podman state may install the promoted
  bundle and join the canary cohort.
- A host whose recorded runtime-state version exactly matches the bundle may
  start normally.
- A tested, explicit state migration may run only for a declared source and
  destination version pair, followed by the full runtime acceptance probe.
- An unknown or incompatible state must fail closed and stay out of placement;
  it must not attempt a best-effort automatic upgrade.
- Rollback must mean replacing the host with one using a compatible state, not
  downgrading binaries over metadata already migrated by a newer major version.

This makes frequent Spot replacement an advantage: new hosts can enter the
upgraded cohort naturally, while existing persistent Podman state is never
implicitly mutated. CNI-to-Netavark, `cgroupfs`-to-systemd, and custom-to-standard
runtime-directory changes must remain independent later experiments.

## Staging canary design

Use dedicated disposable staging hosts. Do not mutate the existing staging host
in place, because container metadata and cgroup-manager changes are not safely
reversible.

### Variants

Run these variants in order, changing one dimension at a time:

1. **Known-stable baseline:** current Podman 4.9.3, crun 1.14.1, CNI, custom
   runtime directory, forced `cgroupfs`, and the older aggregate project cgroup.
2. **Regression reproduction:** the same runtime with the July 13 hierarchical
   and pasta PID-migration changes. This directly tests the leading cause.
3. **Podman 5 bridge:** a pinned current Podman 5.8.x runtime bundle, with all
   other CoCalc settings unchanged.
4. **Podman 6:** a pinned Podman 6.0.1 runtime bundle, again with all other
   CoCalc settings unchanged and the runtime-state contract validated.
5. **Standard runtime directory:** upgraded runtime using `/run/user/2000`, with
   linger and user-manager readiness explicitly verified.
6. **Systemd cgroups:** upgraded runtime with the supported `systemd` cgroup
   manager. Preserve project limits through a delegated systemd slice/cgroup
   parent design; do not manually move arbitrary runtime PIDs after launch.
7. **Network backend:** switch the successful upgraded variant from legacy CNI
   to Netavark.
8. **Alternative engine:** use the same workload contract on a small
   Docker/containerd canary. This requires a narrow runner abstraction, not a
   production rewrite.

### Fault matrix

For every variant, repeatedly test:

- cold VM boot with 0, 10, and 50 projects eligible for recovery;
- GCP Spot preemption during idle, project start, project stop, and recovery;
- project-host software rollout while projects are running;
- kill/restart of the project-host process, user manager, conmon, and Podman
  pause process individually;
- bursts of project starts with concurrency 1, 2, 4, 8, and 16;
- disk near the current observed 80% utilization;
- a mix of long-running terminals, exec, file listing, and file writes;
- stale LRO cleanup across each host process and VM boot transition.

### Required assertions

After every transition:

- SSH must authenticate and create a session within 10 seconds;
- `rootctl doctor`, `podman info`, and `podman ps` must complete within bounded
  time;
- the host heartbeat must report runtime `ready`, not merely arrive;
- direct file listing, project exec, terminal creation, and project start/stop
  must work;
- recovery concurrency must remain within the configured bound;
- no pre-session LRO may remain active;
- no repeated cgroup `EINVAL`, systemd-logind scope timeout, stale pause-process,
  or user-namespace errors may appear;
- project data and Btrfs snapshots must remain intact.

### Promotion gate

Do not promote a variant based on one successful restart. A reasonable minimum
is 200 automated VM/process interruption cycles and at least 1,000 project
start/stop cycles without a host wedge, stale LRO, or data-integrity failure.
Preserve all logs and test identifiers so failures can be correlated across GCP,
systemd, Podman, conmon/crun, and CoCalc.

## Remaining work

- **Complete on staging:** healthy synthetic probes leave no central project
  row, local SQLite row, container, or home/scratch subvolume.
- **Complete on staging:** lifecycle failure quarantines placement, records
  bounded forensic completion, retries after 90 seconds, and a later pass clears
  quarantine.
- **Complete in tests and staging audit:** host-session transitions proactively
  cancel pre-session normal and restore-backed project-start LROs. No stale
  active start LRO remained after the canary reboot and rollout.
- **Complete on staging:** two failures plus completed diagnostics queued one
  hard reboot, and the ten-minute fleet gate prevented a concurrent reboot.
- Deliberately fault one staging host through the complete two-attempt/six-hour
  exhaustion path and verify the 15-minute per-host cooldown and exhausted-
  budget alert. Do not run this production experiment.
- Inject a separate passive `podman ps` failure so the passive detector is
  validated independently of the full lifecycle probe.
- **Complete on staging:** a successful new-boot probe changes automatic
  recovery state from `scheduled` to `recovered` while preserving the rolling
  reboot attempt budget.
- Verify the metadata-backed 15-minute alert limiter under a continuous staged
  failure.
- Enable bounded, retained project-host app core dumps on staging and verify a
  controlled native crash produces a usable core without allowing project
  containers or unrelated host processes to fill the data disk.
- **Complete on staging:** durable app supervision records an actual child
  `SIGSEGV`, host-agent restarts the process in about five seconds, and the new
  process session passes a full synthetic lifecycle probe.
- **Complete on staging:** an explicit operator project-host component rollout
  performs a real graceful restart rather than a healthy `ensure` no-op.
- Build the disposable-host fault-injection harness and complete the 200
  interruption and 1,000 project-cycle baseline on the reverted runtime.
- Package pinned Podman 5.8.x and Podman 6.0.1 runtime bundles, including their
  matching OCI runtime and containers libraries.
- Implement and validate the versioned runtime-state contract used when Spot
  hosts boot or are replaced.
- Design the systemd-slice equivalent of `cocalc-project-pool` before testing the
  `systemd` cgroup manager.
