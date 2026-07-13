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
eliminate the underlying runtime failure. The next step is a controlled staging
canary that changes one variable at a time.

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

Before launching a container, CoCalc moves the Podman launcher into the
project's root-owned cgroup. It then reconciles conmon/container PIDs into that
cgroup. This provides aggregate and per-project resource control, but it is a
substantial deviation from the normal rootless Podman plus systemd lifecycle.

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
    canceled immediately, including restore LROs.

Automatic hard reboot is intentionally not part of this first change. The first
priority is to capture the state before destroying it. Once diagnostic capture
is proven, a separate policy can hard-reboot after repeated failures and a
bounded investigation window.

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

1. Roll back or default-disable the July 13 hierarchical per-project cgroup and
   pasta PID-migration path.
2. Retain Podman's native per-container memory, CPU, and PID limits, the older
   aggregate `cocalc-project-pool` cap, and the host pressure controller. These
   are the established containment layers; this is not a return to uncontained
   projects.
3. Deploy the runtime readiness, diagnostics, alerting, recovery throttling, and
   stale-LRO fixes independently.
4. Do not combine the production rollback with a Podman upgrade or a switch to
   systemd cgroups. Those are staging experiments.
5. Keep the temporary eastern host recovery concurrency cap until the safer
   project-host code is deployed.

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
3. **Runtime upgrade:** a pinned current Podman 5.8.x/crun package set, with all
   other CoCalc settings unchanged.
4. **Standard runtime directory:** upgraded runtime using `/run/user/2000`, with
   linger and user-manager readiness explicitly verified.
5. **Systemd cgroups:** upgraded runtime with the supported `systemd` cgroup
   manager. Preserve project limits through a delegated systemd slice/cgroup
   parent design; do not manually move arbitrary runtime PIDs after launch.
6. **Network backend:** switch the successful upgraded variant from legacy CNI
   to Netavark.
7. **Alternative engine:** use the same workload contract on a small
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

- Deploy the readiness/diagnostic changes to staging and verify that a simulated
  failed probe removes the host from placement and creates exactly one alert.
- Build the disposable-host fault-injection harness and baseline the current
  runtime before upgrading it.
- Decide how to package a current Podman version reproducibly for Ubuntu hosts.
- Design the systemd-slice equivalent of `cocalc-project-pool` before testing the
  `systemd` cgroup manager.
- After forensic capture is validated, define a controlled hard-reboot policy,
  for example after three failed probes and a two-minute diagnostic window.
- Add fleet-level synthetic project start/exec probes so user traffic is not the
  first indication of a degraded host.
