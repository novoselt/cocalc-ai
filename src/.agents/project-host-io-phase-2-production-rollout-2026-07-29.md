# Project Host I/O Phase 2 Production Rollout

Date: 2026-07-29 PDT / 2026-07-30 UTC

Status: hard I/O containment is deployed to all 13 site-owned production
project hosts. Storage admission enforcement is enabled only on the
`us-south-1` and `wstein` canaries.

## Deployed Artifacts

- Project-host:
  `20260729T183021Z-993424af-io-phase2-993424af`
- Bootstrap:
  `20260729T183251Z-47128cd8-io-phase2-47128cd8`
- Bootstrap content SHA-256:
  `e4a46af25c674db907b4c2215a8bbd4a6dbe526ce42a6e29ca9e6d0b9ed2e707`
- I/O policy profile:
  `prod-gcp-pd-balanced-dynamic-v1`
- Capacity source:
  `gcp-pd-balanced-size-formula-2026-07-24`
- Storage admission mode:
  `observe` by default; `enforce` on `us-south-1` and `wstein`

## Canary Evidence

The `wstein` canary ran for about five hours before the fleet rollout. During
that interval:

- project-host remained promoted and healthy;
- public route probes continued to pass;
- application command execution succeeded;
- the effective I/O policy remained `enforce/validated`;
- no legacy project-pool processes or stale cgroup drift were observed;
- real project-pool pressure episodes reached about 32% full PSI and recovered;
- a live scheduled backup produced about 49% full PSI in the maintenance
  cgroup while project-pool pressure remained 0%, confirming maintenance
  isolation;
- no route degradation, automatic rollback, kernel storage error, or Btrfs
  error occurred.

The second canary was `eastern-europe-1`. The rollout deliberately separated:

1. helper/bootstrap convergence;
2. capacity and policy validation;
3. project-host upgrade and promotion;
4. public route and telemetry validation.

The first policy check correctly remained disabled because the host had no
production override. After installing the established production profile, the
host reported `enforce/validated`, promoted the Phase 2 project-host bundle,
and passed public health and CORS checks.

## Fleet Rollout

The rollout was serial within each wave. Every host had to pass before the next
host was changed.

1. Low-load wave:
   `asia-2`, `asia-3`
2. Medium wave:
   `western-europe-2`, `us-south-2`, `oceania-1`
3. General wave:
   `us-south-1`, `los-angeles-1`, `montreal-2`
4. Existing enforcement canary:
   `montreal-1`
5. High-load hosts, one at a time:
   `western-europe-1`, `asia-1`

Together with `wstein` and `eastern-europe-1`, this enrolled all 13 site-owned
production hosts.

Each host passed these gates:

- helper-only bootstrap reconcile succeeded;
- desired capacity provider was `gcp`;
- the dynamic `pd-balanced` policy reported `enforce/validated`;
- project-pool and maintenance `io.max` values were nonempty and derived from
  discovered block-device capacity;
- `legacy_process_count` was zero;
- the project-host candidate promoted to last-known-good;
- current metrics reported the expected policy profile;
- no host storage alert was present at the rollout gate;
- the public `/healthz` route returned ready with the expected `host_id`.

The final fleet audit found:

- 13 of 13 hosts running;
- 13 of 13 on the Phase 2 project-host artifact;
- 13 of 13 reporting `enforce/validated`;
- 13 of 13 public routes healthy;
- 13 of 13 bootstrap states `in_sync`;
- zero bootstrap drift on every host;
- zero legacy project-pool processes on every host.

Several hosts showed simultaneous maintenance-cgroup pressure with zero
project-pool pressure. This is expected and provides natural production
evidence that scheduled maintenance is being isolated from project workloads.

## Admission Enforcement Canary

On 2026-07-30 UTC, storage admission enforcement was enabled on:

- `us-south-1`
  (`7bd699f8-e20b-4b13-9dfa-f7358f85544e`);
- `wstein`
  (`d0102bef-c8f8-4f63-9c70-450162bac80b`).

The setting is a durable host-local override in
`/etc/cocalc/project-host.local.env`:

```text
COCALC_PROJECT_HOST_STORAGE_ADMISSION_MODE=enforce
```

The pre-change files are preserved on each host as
`/etc/cocalc/project-host.local.env.pre-admission-enforce-20260730`.
Bootstrap reads the local file and preserves it across normal reconcile and
spot stop/start cycles. This is still not durable control-plane policy and can
be lost if the root disk is reprovisioned.

Activation required a controlled restart of the project-host control daemon.
A same-version `host rollout --component project-host` on `us-south-1`
reported success but did not change the running PID or process environment.
The supported host-local
`sudo -u cocalc-host -H /opt/cocalc/project-host/bin/ctl restart` path was
therefore used on both canaries. Project containers were not restarted.

Post-activation gates passed:

- both supervisor and app processes inherited admission mode `enforce`;
- metrics reported `storage_admission.mode=enforce`;
- public `/healthz` returned ready with the expected `host_id`;
- the monitoring-equivalent `podman ps -a --format json` probe completed in
  0.04 seconds on `us-south-1` and 0.03 seconds on `wstein`;
- `us-south-1` retained all 47 running projects;
- `wstein` retained all 5 running projects;
- no project was starting or stopping;
- both hosts moved from initial `emergency` pressure to `recovery` during the
  short validation window, with zero current project and maintenance full
  pressure.

At activation, neither host had a new scheduled or scavenger operation to
defer, so `deferred_total` remained zero. The canary must remain in observation
until a real pressure episode confirms that background work is deferred while
interactive and lifecycle operations remain available.

Rollback is:

1. restore the preserved local environment file;
2. restart only the project-host control daemon once with `ctl restart`;
3. verify process environment, public identity health, container-runtime
   health, and unchanged running-project count.

## Important Remaining Gaps

### Policy assignment is not durable control-plane state

The capacity manifest and helper deployment are reconciled, but the production
enforcement profile is still supplied by
`/etc/cocalc/project-io-policy.override.json`. This survives ordinary service
restarts and spot stop/start cycles, but it is not the target architecture and
may be lost with root-disk reprovisioning.

Durable policy assignment remains the next required control-plane change. The
owning bay must store the desired profile and project it into the managed base
policy. The override file should then return to its intended role as an
audited, expiring emergency override.

### `stale_project_count` is misnamed

The I/O telemetry collector samples at most 32 project leaves per interval.
It currently reports:

```text
stale_project_count = total_project_count - sampled_project_count
```

On busy hosts this produced large apparent stale counts after rollout even
though the cgroups were valid and capped. This field means "not sampled in this
interval", not "stale cgroup", and should be renamed or corrected without
breaking telemetry compatibility.

### Admission enforcement is canary-only

The production fleet remains in `observe` mode except for `us-south-1` and
`wstein`. Fleet rollout must wait for canary evidence from real pressure and
maintenance cycles. The desired mode is also not yet assigned by durable
control-plane policy.

The same-version managed rollout no-op must be fixed or explicitly rejected
before using that path for a fleet-wide environment-only activation. A rollout
must not report success unless the requested component actually restarted and
the new process inherited the desired configuration.

## Unrelated Observation

The final audit reported a shared-scratch growth warning on `wstein`, projecting
exhaustion within roughly 6.3 hours at the then-current growth rate. The main
project disk, I/O policy, route, and project-host were healthy. This warning is
not an I/O Phase 2 rollout failure and needs separate scratch-capacity
follow-up.
