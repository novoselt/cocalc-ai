# Project Host Capacity-Aware I/O Staging Results

Date: 2026-07-24

Production status: unchanged. This campaign did not deploy an artifact, change
an I/O policy, attach storage, or reconcile a host in production.

## Scope

This campaign replaces fixed per-host staging ceilings with a reversible,
capacity-aware policy for GCP `pd-balanced` project storage. It extends the
static containment implementation documented in
`project-host-io-containment-final-staging-results-2026-07-22.md`.

The implementation:

- derives conservative pool and project limits from actual writable block
  device sizes;
- discovers both the Btrfs project data disk and an enabled shared `/scratch`
  disk;
- writes one `io.max` row per writable device at the project-pool and project
  leaf levels;
- recalculates limits during bootstrap, helper reconciliation, Btrfs growth,
  and shared-scratch growth;
- preserves the existing static policy format as the default and as a
  compatibility fallback;
- clears all current device limits in `observe` or `disabled` mode;
- fails closed in dynamic enforcement mode when required provider or device
  metadata is missing or unsupported.

The work does not implement snapshot-prune journaling or project-attributed
snapshot deletion. Those remain separate Phase 2 work.

## Source And Artifacts

The source is branch `ops` at commit `6bfc3b7a67`
(`project-host: mount shared scratch before I/O reconciliation`). The
implementation commits are:

- `066921c457` - capacity-aware policy, manifests, runtime integration, and
  tests;
- `04548fe002` - corrected helper/runtime lifecycle classification.
- `6bfc3b7a67` - mount ordering for newly attached shared scratch before
  fail-closed containment reconciliation.

All three commits are pushed to `origin/ops`.

The exact staging artifacts are:

- host bootstrap:
  `20260724T200507Z-6bfc3b7a-io-capacity-scratch-order-20260724-v3`;
- project host:
  `20260724T182303Z-04548fe0-io-capacity-20260724-v2`;
- hub:
  `20260724T181730Z-04548fe0-io-capacity-20260724-v2`;
- active staging hub release: `20260724181904-hub`.

The project-host artifact has SHA-256
`e0b479cad46f7fb7a675b5e039e97339d5dc1d912d039a405b8a145d94d36bb`.
The installed bootstrap script has SHA-256
`1a4b29a4583d692ecde25eac4262a302672546097fa7f5969255a5bd66438b94`.

## Capacity Model

The dynamic profile is `staging-gcp-pd-balanced-dynamic`, with capacity source
`gcp-pd-balanced-size-formula-2026-07-24`.

For total writable `pd-balanced` capacity `S` GiB, the helper starts with the
documented GCP baseline and size scaling:

- physical IOPS: `min(15000, 3000 + 6*S)`;
- physical read bandwidth: `min(240 MiB/s, 140 MiB/s + 0.28 MiB/s*S)`;
- physical write bandwidth: `min(200 MiB/s, 140 MiB/s + 0.28 MiB/s*S)`.

The aggregate project-pool envelope uses:

- 50% of physical read bandwidth;
- 25% of physical write bandwidth;
- 50% of physical read IOPS;
- 25% of physical write IOPS.

This leaves at least 50% read and 75% write/IOPS capacity outside the aggregate
project pool for the host control plane and maintenance. Project classes use
25%, 50%, and 75% of the pool envelope for standard, member, and premium,
respectively. With multiple writable devices, every cgroup receives an
`io.max` row for every device and the aggregate envelope is partitioned evenly
across those rows.

These fractions are deliberately conservative initial values. They are not a
claim that cloud burst performance is guaranteed.

## Deployment

### Hub

The matching hub source was required because the hub renders trusted provider,
disk type, and writable-target metadata into the bootstrap desired state. The
staging hub deployment completed with four healthy workers and:

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

### Project host

The durable project-host rollout operation was
`92086b4a-273a-4994-91cd-d472906beb14`.

1. Host2 (`37782b66-190d-41c3-a7e5-f5662e34cd4a`) was the canary.
2. Host2 passed artifact install, health acceptance, and a 60-second
   stabilization gate.
3. Host (`7843c648-86e4-45d3-9ed2-85ebe9faf9ee`) was upgraded in a
   single-host wave and passed a 30-second stabilization gate.
4. The new artifact was promoted as the staging default.

Both active staging hosts report the artifact as installed, running, healthy,
and last-known-good.

### Privileged helpers

The corrected bootstrap was rolled out helpers-only after the project-host
rollout. Reconcile operations were:

- host: `50b982cc-a12e-4d1a-a252-15744dbac8ff`;
- host2: `cbec5aae-f105-4a25-a92b-d2aa97f1fa3a`.

Both succeeded without restarting the project-host daemon. Both lifecycle
reports are `in_sync`, with helper schema `20260718-v14` and runtime wrappers
`20260724-v15`.

The capacity manifest on both hosts identifies GCP, a required Btrfs target at
`/mnt/cocalc`, and balanced disks. Host2's manifest also contains the required
`/mnt/cocalc-scratch` target.

### Shared-scratch bootstrap correction

The first host2 scratch transition exposed an ordering defect: network
reconciliation created the project cgroup hierarchy and applied fail-closed
dynamic I/O limits before the newly attached scratch disk had been formatted
and mounted. The helper correctly refused to enforce an incomplete required
capacity manifest, causing that bootstrap operation to fail without affecting
the running project-host or public ingress.

Host2 was recovered by temporarily selecting the existing `disabled` policy,
reconciling away current limits, completing the full bootstrap so the scratch
disk could be formatted and mounted, restoring the exact saved `enforce`
policy, and reconciling the two-device limits. No production state was
involved.

Commit `6bfc3b7a67` now establishes all writable mounts before network or I/O
containment reconciliation. Its clean immutable bootstrap artifact was
promoted as the staging desired version. Full reconcile operations then
succeeded on:

- host2 canary: `f340bdd9-c116-48fa-8c5d-ae8fe7277755`;
- host: `151efe43-a695-45c1-bca2-002a9aefaf3e`.

Both active staging hosts are `in_sync`, and both direct public health routes
returned HTTP 200 after reconciliation.

## Live Policy Results

### Host2

Host2 has a 75 GiB `pd-balanced` data disk and a 50 GiB `pd-balanced`
shared-scratch disk:

```text
device 8:16 (/dev/sdb): /mnt/cocalc
device 8:32 (/dev/sdc): /mnt/cocalc-scratch
aggregate physical model: 175 MiB/s and 3750 IOPS
pool per device: 43.75 MiB/s read, 21.875 MiB/s write, 937/468 IOPS
standard leaf per device: 10.9375 MiB/s read, 5.46875 MiB/s write, 234/117 IOPS
premium leaf per device: 32.8125 MiB/s read, 16.40625 MiB/s write, 702/351 IOPS
```

The live helper reports:

- `policy_mode=enforce`;
- `capacity_mode=gcp-pd-balanced`;
- `capability=validated`;
- `legacy_process_count=0`;
- no current I/O pressure after the tests.

The derived capacity is 125 GiB across two devices. The project-pool and every
active project leaf have exact class-specific rows for both devices.

### Host

Host has one 125 GiB `pd-balanced` writable data disk:

```text
device 8:16 (/dev/sdb)
physical model: 175 MiB/s and 3750 IOPS
pool: 87.5 MiB/s read, 43.75 MiB/s write, 1875/937 IOPS
standard leaf: 21.875 MiB/s read, 10.9375 MiB/s write, 468/234 IOPS
premium leaf: 65.625 MiB/s read, 32.8125 MiB/s write, 1406/702 IOPS
```

The live helper reports the same validated dynamic profile, zero legacy
processes, and no current I/O pressure. All six active leaves have exact
class-specific rows; three are standard and three are premium.

## Staging Validation

### Runtime and ingress smoke

- Project-host software smoke passed after the project-host rollout.
- It passed again after the helpers-only rollout and both policy switches.
- Both direct public project-host `/healthz` routes returned
  `{"ok":true,"ready":true}`.
- Both hosts remained in the control-plane `running` state with current
  heartbeats.
- Final sampled load was 0.45 on host and 0.20 on host2.

### Host2 direct bandwidth

Project `a863f349-472b-4a06-a4ec-003826fc5e28` is a disposable load project on
host2. A 64 MiB direct-I/O test measured:

- write: 6.398 seconds, or 10.0 MiB/s;
- read: 3.152 seconds, or 20.3 MiB/s.

These match the dynamic standard leaf ceilings of 10.0625 and 20.125 MiB/s.
An incompressible 4 KiB direct write test measured approximately 211 IOPS
against a 215 IOPS ceiling.

Sequential 4 KiB read operations were merged by the storage stack and were not
used as evidence for the read IOPS ceiling. The exact read IOPS row is present
and the earlier static-policy campaign already validated random read IOPS.

### Primary-host class result

Premium test project `b81b7013-e5ea-4fe6-bd26-82bd2207f851` performed a
64 MiB direct-I/O test:

- write: 1.966 seconds, or 32.55 MiB/s;
- read: 0.939 seconds, or 68.16 MiB/s.

The write result matches the 32.8125 MiB/s premium ceiling. The short read test
is consistent with the 65.625 MiB/s ceiling within timing and queueing noise.

### Ingress under sustained contained I/O

While the host2 test project performed a 256 MiB incompressible direct write:

- the project completed normally in 25.488 seconds;
- all 20 concurrent public host health probes returned HTTP 200;
- probe latency was 79-150 ms, averaging 111 ms;
- the test file was removed.

### Fresh project start

Previously stopped test project `5d7d3372-78bf-4d3b-85d1-09649a735b1e` was
started after the final project-host and helper rollouts. It:

- reached `running`;
- executed a command successfully;
- received its premium dynamic leaf row immediately.

After shared scratch was attached, the project was started again in a fresh
sandbox. It mounted `/dev/sdc` as ext4 at `/scratch`, passed a write/read/remove
smoke test there, and received both premium rows:

```text
8:16 rbps=34406400 wbps=17203200 riops=702 wiops=351
8:32 rbps=34406400 wbps=17203200 riops=702 wiops=351
```

The project was stopped after the check. This verifies start-time policy
parsing and fail-closed cgroup attachment, not only reconciliation of existing
leaves.

### Rollback

Host2's dynamic override was saved, changed temporarily to `disabled`, and
reconciled:

- the project-pool `io.max` became empty;
- the active test project's leaf `io.max` became empty;
- public ingress and the host daemon remained healthy.

The exact saved dynamic override was restored and reconciled:

- the pool row returned exactly;
- the standard leaf row returned exactly;
- status returned to `enforce/validated`;
- `legacy_process_count` remained zero.

This validates the emergency off switch and recovery without a reboot or
artifact rollback.

### Shared scratch

The staging control plane created and attached a 50 GiB balanced scratch disk
to host2. The final capacity manifest contains required targets for both
`/mnt/cocalc` and `/mnt/cocalc-scratch`; the latter is mounted from `/dev/sdc`
as ext4.

A 64 MiB incompressible direct-I/O test inside the fresh project sandbox
measured:

- write: 3.935 seconds, or 16.26 MiB/s;
- read: 1.934 seconds, or 33.09 MiB/s.

These match the premium per-device ceilings of 16.40625 MiB/s write and
32.8125 MiB/s read.

While the project performed a 512 MiB incompressible direct write to
`/scratch`:

- the project completed normally in 31.238 seconds;
- all 20 concurrent public host health probes returned HTTP 200;
- probe latency was 34-87 ms;
- the test file was removed.

The disposable project was stopped. The scratch disk is intentionally retained
on host2 to provide durable multi-device staging coverage for future
bootstrap, growth, and containment changes.

## Local Validation

Validation on the final source passed:

- 68 privileged bootstrap Python tests;
- 25 server bootstrap-host tests;
- 11 focused project-runner policy tests;
- package typechecks for project-runner, conat, and server;
- Prettier;
- `git diff --check`.

The staging software smoke test also fetched the promoted bootstrap script and
its SHA-256 sidecar successfully.

The prior containment campaign also passed the full project-host package suite
and direct metadata-stress matrix. This change does not alter the cgroup
hierarchy or privileged deletion attribution established there.

## Production Recommendation

Do not change production yet.

After a staging soak period:

1. deploy the already-built project-host and helper code with all production
   host policies still unchanged;
2. select one lower-risk GCP `pd-balanced` host as a dynamic-policy canary;
3. confirm actual data and scratch devices, exact derived limits, active leaves,
   pressure, ingress, and fresh project starts;
4. soak the canary for at least 24 hours;
5. expand only to other GCP `pd-balanced` hosts, one host at a time;
6. leave Nebius and unsupported disk types on explicit static or disabled
   profiles until provider-specific validation exists.

The production rollback is a host-local policy change to `disabled` or restore
of the saved static override, followed by
`cocalc-runtime-storage reconcile-project-io-policy`. It does not require a
host reboot or project-host artifact rollback.
