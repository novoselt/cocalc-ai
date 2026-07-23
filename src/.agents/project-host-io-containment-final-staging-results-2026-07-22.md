# Project Host I/O Containment Final Staging Results

Date: 2026-07-22

Production status: unchanged. No production I/O policy, host artifact, bootstrap
artifact, or hub artifact was changed during this campaign.

## Scope

This campaign completes the staging implementation and validation of the Phase
0 telemetry and Phase 1 static `io.max` safety envelope described in
`project-host-io-containment-plan-2026-07-20.md`.

It does not complete Phase 2. In particular, snapshot path pruning still lacks
the durable operation journal, transition-by-transition recovery, and atomic
trash workflow required by that phase. The static cgroup boundary may be
reviewed and rolled out independently, but Phase 2 must not be represented as
complete.

## Source And Artifacts

The final source is branch `io-containment-finish-20260722`, commit
`71e085d657` (`project-host: harden I/O containment enforcement`), based on
`fec1389fb1`. The branch is pushed to GitHub.

The exact staging artifacts were:

- bootstrap: `20260722T194917Z-71e085d6-io-containment-final-20260722`;
- project-host: `20260722T195330Z-71e085d6-io-containment-final-20260722`;
- hub: `20260722T195709Z-71e085d6-io-containment-final-20260722`;
- active hub release: `20260722195832-hub`.

The final source hardens the existing implementation in these areas:

- strict, matching TypeScript and privileged Python policy parsers;
- rejection of leaf ceilings that exceed the aggregate pool ceiling;
- complete clearing of pool and leaf limits in `observe` and `disabled` modes;
- explicit unsupported-device status instead of an unstructured command
  failure;
- bounded telemetry whose sampling failure cannot erase the last verified
  enforcement state;
- fail-closed placement for an explicitly enforced host that is not currently
  validated, without taking existing projects or direct connections offline;
- placement-context-only host catalog reasons, avoiding false outage banners
  for projects already running on a host.

## Staging Policy

Both staging hosts use the explicit profile
`staging-gcp-pd-balanced-conservative`. Bootstrap discovers Btrfs at
`/mnt/cocalc` on `/dev/sdb`, currently device `8:16`, and applies:

| Scope or class | Read B/s | Write B/s | Read IOPS | Write IOPS |
| -------------- | -------: | --------: | --------: | ---------: |
| project pool   | 64 MiB/s |  32 MiB/s |     2,000 |      1,000 |
| standard       | 16 MiB/s |   8 MiB/s |       500 |        250 |
| member         | 32 MiB/s |  16 MiB/s |     1,000 |        500 |
| premium        | 48 MiB/s |  24 MiB/s |     1,500 |        750 |

These remain conservative staging values, not proposed production defaults.
The current scheduler is `none`; `io.weight` fairness is not claimed and
`io.max` is the safety boundary.

## Deployment

Deployment was host2-first and did not use a source-tree build on the hosts.

1. Published the bootstrap desired state without a fleet rollout.
2. Reconciled privileged helpers on host2 and verified installed hashes.
3. Installed the exact project-host artifact on host2.
4. Deployed the matching hub artifact after checking the ancestry and patch
   equivalence of the existing staging hotfix builds.
5. Promoted project-host with host2 as the canary, a 60-second stabilization
   gate, then host with one host per wave and a 30-second stabilization gate.
6. Forced a helpers-only reconcile on both hosts and verified desired and
   installed bootstrap/project-host versions were in sync.

The project-host rollout operation was
`8120fb79-d9ff-47af-8b9c-222f980bfe2f`; both hosts succeeded.

## Final-Artifact Validation

### Policy and rollback

- Both hosts report `policy_mode=enforce`, `capability=validated`, profile and
  capacity provenance, exact pool limits, and zero legacy processes.
- A temporary `observe` override on host2 cleared the pool and every active
  leaf `io.max` entry. Restoring `enforce` restored the exact pool and all six
  active leaf limits without a reboot.
- A policy with a standard read ceiling above the pool ceiling was rejected
  with `leaf rbps exceeds pool rbps`; the live pool and leaves were unchanged.
- Both helper-only fleet reconciliations succeeded and left the final policy
  validated.

### Fail-closed placement

After project-host had recorded a verified enforced baseline, host2's policy
was temporarily made invalid. On the next metrics cycle:

- telemetry retained `policy_mode=enforce` and the last verified identity;
- capability changed to `unsupported` with the parser error recorded;
- the hub returned `can_place=false` for new placement;
- the host remained online and ready, its connection URL remained available,
  and public `/healthz` continued returning 200.

Restoring the exact policy and reconciling returned host2 to
`enforce/validated` and `can_place=true` on the next sample.

### Containment and data plane

The previous staging artifact established the underlying limits with direct
I/O, aggregate contention, and metadata stress:

- standard direct writes and reads matched 8/16 MiB/s;
- direct 4 KiB writes and reads matched the 250/500 IOPS limits;
- three raised leaves reached the 32 MiB/s parent write ceiling;
- a contained five-million-file delete completed while an unrelated project's
  direct listings remained at or below 24 ms and host control stayed alive;
- a host reboot rediscovered the device and restored pool and leaf limits.

The final artifact retained those policy values and added these post-deployment
checks:

- 64 MiB direct write/read on host2 completed in 8.029/4.011 seconds,
  consistent with a standard 8/16 MiB/s leaf;
- a project on host was restarted successfully, immediately executed a fresh
  command, then completed a 64 MiB direct write/read in 2.644/1.317 seconds,
  consistent with its configured 24/48 MiB/s envelope;
- real project commands succeeded on both staging hosts;
- both direct proxied host ingress endpoints returned ready HTTP 200 health in
  49-70 ms;
- all four staging hub workers routed successfully to both hosts, covering all
  eight worker/host paths in 844-874 ms;
- twenty concurrent public health probes during the direct-I/O check completed
  in 27-59 ms;
- the post-rollout project-host logs contained no containment, cgroup verify,
  crash, fatal, or reconciliation errors.

### Telemetry and host health

The final samples for both hosts reported:

- Btrfs `/mnt/cocalc`, `/dev/sdb`, device `8:16`, scheduler `none`;
- exact aggregate `rbps=67108864 wbps=33554432 riops=2000 wiops=1000`;
- `stale_project_count=0`, `legacy_process_count=0`, and no truncation;
- all active leaves sampled: four on host and six on host2;
- no host alerts and admission allowed.

At the end of validation, one-minute load was 1.45 on host and 0.53 on host2.

## Local Validation

Validation on the final source included:

- full development build;
- affected package builds for conat, project-runner, project-host, and server;
- 41 focused project-runner tests;
- 99 project-host suites with 606 tests;
- 14 server project-host control tests;
- 64 privileged bootstrap tests;
- 10 file-server snapshot tests and 6 backend delete tests;
- Prettier and `git diff --check`.

All passed.

## Remaining Gates

Before a production canary:

1. Review commit `71e085d657` and this evidence.
2. Let the final all-staging deployment soak for at least 24 hours, watching
   heartbeat age, event-loop delay, pressure, and reconciliation errors.
3. Choose provider-specific production ceilings from measured disk capacity;
   do not copy the staging values automatically.
4. Start with one lower-risk GCP host and an explicit rollback path.
5. Keep automatic project stopping, `io.cost`, adaptive caps, and weighted
   fairness disabled.

Outstanding work that is not a gate for the static GCP canary but remains part
of the overall plan includes durable Phase 2 snapshot-prune recovery,
multi-device Btrfs, device reattachment, unsupported-controller integration,
and provider-specific Nebius validation.
