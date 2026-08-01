# Project Warm-Start P95 Under Three Seconds: Staging Results

Date: 2026-08-01

Status: staging qualification passed; no production deployment was performed

Related strategy:

- `src/.agents/project-start-p95-3s-strategy-2026-07-31.md`
- `src/.agents/project-host-quota-startup-scalability-plan-2026-07-30.md`

## Result

The qualified staging implementation met the warm project-start goal. Across
540 eligible starts, browser-observed P95 was 2.357 seconds. Every one of five
108-sample scenarios had browser P95 below three seconds. There were no failed
starts and no samples above five seconds.

The test definition matched the strategy: projects were already provisioned,
the host and RootFS were warm, no restore or migration was required, and the
browser observed the authoritative `running` state. RootFS acquisition was
measured separately and was zero on the qualified path.

The result requires an explicit QoS tradeoff: four of the 16 host cores were
reserved for host and lifecycle work, leaving 12 cores in the project pool.
Project I/O containment and storage admission enforcement were enabled. This
is not a claim that arbitrary overload can meet the SLO without admission,
throttling, or reserved capacity.

## Exact Environment

- Site: staging only (`https://staging.cocalc.ai`)
- Host: `p95-europe-t2d16`
- Host ID: `7f026250-c384-4396-880f-711fc5285f78`
- Region/zone: `europe-west4-b`
- Machine: GCP `t2d-standard-16`, on demand
- Storage: 200 GB balanced persistent disk, Btrfs
- Dormant inventory: 10,000 synthetic host-ID-gated projects
- Total assigned projects during qualification: 10,021
- Real benchmark projects: 12
- Real load projects: 8
- Runtime artifact:
  `20260801T170654Z-fd9ff345-p95-fresh-scratch-fd9ff345`
- Runtime source commit: `fd9ff3459a21`
- Project pool CPU policy: `cpu.max = 1200000 100000`
- Quota ledger: enforce
- I/O containment: enforce/validated
- Storage admission: enforce

The browser benchmark ran from the staging bay, geographically separated from
the project host. The resulting roughly 300 ms start-RPC transport cost is
therefore part of the observed budget rather than a loopback benchmark.

## Scenario Results

All values are milliseconds except sample and failure counts.

| Scenario           | Samples | Failures | Browser P50 |  P90 |  P95 |  P99 |  Max | Backend P95 | Runner P95 | Quota P95 | State P95 |
| ------------------ | ------: | -------: | ----------: | ---: | ---: | ---: | ---: | ----------: | ---------: | --------: | --------: |
| Idle               |     108 |        0 |        1963 | 2090 | 2412 | 3124 | 3203 |        2022 |       1427 |         2 |        50 |
| CPU                |     108 |        0 |        2011 | 2142 | 2207 | 2567 | 2965 |        2000 |       1349 |         2 |        51 |
| CPU + buffered I/O |     108 |        0 |        2118 | 2234 | 2528 | 2965 | 4379 |        2063 |       1449 |         2 |        49 |
| Random direct I/O  |     108 |        0 |        2167 | 2277 | 2293 | 2552 | 2767 |        2059 |       1452 |         2 |        57 |
| Post-I/O recovery  |     108 |        0 |        2167 | 2284 | 2587 | 3261 | 3438 |        2096 |       1489 |         2 |        70 |
| Combined           |     540 |        0 |        2110 | 2249 | 2357 | 3124 | 4379 |        2055 |       1446 |         2 |        57 |

The CPU scenario used eight one-core project workloads. The mixed scenario
used six CPU workloads and two bounded buffered writers with periodic
`fdatasync`, producing about 50 MB/s of physical writes and high I/O PSI. The
direct-I/O scenario used eight bounded random 4 KiB `O_DIRECT` writers. At the
start of that cohort, storage admission reported `emergency`, host full-I/O
pressure was 32.56%, and project-pool full-I/O pressure was 44.23%. The load
processes remained active for the cohort, while the enforced project-pool cap
preserved host headroom. The recovery cohort began immediately after safely
terminating and deleting the direct-I/O test files.

## Combined Phase Distribution

These are all server phase keys emitted by the qualified 540 starts. Values
are milliseconds.

| Phase                                           |  P50 |  P90 |  P95 |  P99 |  Max |
| ----------------------------------------------- | ---: | ---: | ---: | ---: | ---: |
| `apply_pending_copies`                          |    0 |    0 |    0 |    0 |    0 |
| `cache_rootfs`                                  |    0 |    0 |    0 |    0 |    1 |
| `check_quota`                                   |    1 |    2 |    2 |    2 |    2 |
| `control.admission_and_slot_reserve`            |    6 |    7 |    7 |   10 |   18 |
| `control.clear_active_operation`                |    1 |    2 |    2 |    3 |   10 |
| `control.project_start`                         | 1891 | 2001 | 2045 | 2889 | 4197 |
| `control.save_authoritative_running_state`      |    8 |    9 |    9 |   11 |   13 |
| `control.slot_heartbeat`                        |    1 |    2 |    2 |    2 |    4 |
| `control.stop_progress_forward`                 |    0 |    0 |    0 |    0 |    1 |
| `control.total`                                 | 1901 | 2012 | 2055 | 2899 | 4209 |
| `host_control.cancel_stale_lros`                |    1 |    2 |    2 |    3 |    6 |
| `host_control.cpu_policy`                       |    1 |    1 |    1 |    3 |    4 |
| `host_control.load_project`                     |    4 |    5 |    5 |    6 |    8 |
| `host_control.placement_and_client`             |  124 |  129 |  129 |  130 |  133 |
| `host_control.restore_metadata`                 |    0 |    1 |    1 |    1 |    1 |
| `host_control.runtime_policy`                   |    1 |    1 |    1 |    1 |    3 |
| `host_control.start_rpc`                        | 1747 | 1856 | 1894 | 2737 | 4054 |
| `host_control.start_rpc_transport`              |  295 |  302 |  305 |  320 |  465 |
| `host_control.state_snapshot`                   |    0 |    1 |    1 |    1 |    1 |
| `host_control.total`                            | 1885 | 1994 | 2039 | 2883 | 4192 |
| `managed_network_admission`                     |  137 |  168 |  179 |  181 |  213 |
| `mark_running_state`                            |    2 |    2 |    3 |    6 |   13 |
| `mark_starting_state`                           |    2 |    2 |    2 |    9 |   15 |
| `prepare_config`                                |    1 |    1 |    1 |    1 |    1 |
| `prepare_oci_pull_reservation`                  |    5 |    6 |   11 |   19 |   51 |
| `project_host.unattributed`                     |    0 |    0 |    0 |    0 |    0 |
| `project_host.wall_total`                       | 1454 | 1554 | 1604 | 2429 | 3763 |
| `refresh_authorized_keys`                       |    1 |    1 |    2 |   10 |   14 |
| `resolve_start_metadata`                        |    1 |    1 |    1 |    2 |    2 |
| `runner_start`                                  | 1305 | 1403 | 1451 | 2255 | 3628 |
| `runner_start.allocate_ports`                   |    0 |    0 |    0 |    0 |    1 |
| `runner_start.build_environment`                |    1 |    1 |    1 |    6 |   35 |
| `runner_start.container_preflight`              |   33 |   35 |   39 |   49 |   59 |
| `runner_start.ensure_local_path`                |  162 |  172 |  179 |  211 | 2475 |
| `runner_start.finalize_project_cgroup`          |  202 |  231 |  244 |  265 |  318 |
| `runner_start.lifecycle_lock_wait`              |    0 |    0 |    0 |    0 |    1 |
| `runner_start.mount_rootfs`                     |    4 |    5 |    5 |   11 |   30 |
| `runner_start.podman_create`                    |  170 |  196 |  210 |  622 |  860 |
| `runner_start.podman_start`                     |  659 |  696 |  719 | 1174 | 1464 |
| `runner_start.prepare_home`                     |    6 |    7 |   15 |   27 |   40 |
| `runner_start.prepare_node_runtime_compat_libs` |    1 |    2 |    2 |    2 |    2 |
| `runner_start.prepare_project_secrets`          |    1 |    1 |    2 |    2 |   12 |
| `runner_start.resolve_cgroup_limits`            |    0 |    0 |    0 |    1 |    1 |
| `runner_start.resolve_initial_paths`            |    0 |    1 |    1 |    1 |    1 |
| `runner_start.resolve_podman_runtime`           |    0 |    1 |    1 |    1 |    1 |
| `runner_start.resolve_project_script`           |    1 |    1 |    1 |    1 |   13 |
| `runner_start.resolve_shared_scratch`           |    0 |    0 |    0 |    1 |    1 |
| `runner_start.restore_backup`                   |    0 |    0 |    0 |    1 |    1 |
| `runner_start.total`                            | 1301 | 1398 | 1446 | 2252 | 3626 |
| `runner_start.unattributed`                     |    2 |    3 |    4 |    5 |    5 |
| `runner_start.verify_container_running`         |   46 |   50 |   53 |   59 |   72 |
| `total`                                         | 1456 | 1563 | 1613 | 2433 | 3763 |

Browser-side authoritative state observation across all scenarios was
P50/P90/P95/P99/max = 32/50/57/70/98 ms. The larger aggregate browser
observation interval also contains request dispatch and the geographically
separated control-plane round trip; the authoritative post-backend state
propagation itself remained well below the 250 ms gate.

## Implementation Under Review

The review branch is `staging/project-start-instrumentation`. The relevant
commits after the pre-existing branch base are:

1. `110088d89d` - keep stop preparation off the lifecycle path
2. `e8483d61d8` - reserve CPU headroom for warm starts
3. `c306118429` - persist quota ledger enforcement
4. `5a57a00760` - test quota ledger rollback override
5. `37ec822fc7` - keep overlay teardown off the restart path
6. `c1580541bf` - avoid global file-server sync on host startup
7. `5ac57d1668` - remove the periodic full-filesystem sync probe
8. `fd9ff3459a` - skip qgroup reads for freshly recreated scratch
9. `7e4fd20990` - add the bounded staging startup load driver

The deployed artifact ends at `fd9ff3459a`; the final commit only adds the
staging-only load driver and does not change runtime behavior.

## Important Diagnostic And Fix

An earlier recovery test on the preceding artifact produced a 7.321-second
browser start. The backend took 7.060 seconds and `check_quota` took 3.745
seconds. Exact logs showed that foreground start awaited its post-stop scratch
preparation, which had recreated an empty scratch volume and then performed a
physical Btrfs qgroup observation under I/O recovery pressure.

Commit `fd9ff3459a` makes the fresh-volume invariant explicit. A newly created
scratch volume is known empty and unlimited, so it does not need either
physical qgroup observation. Finite quota requests still force the physical
Btrfs quota write, and the durable desired/applied ledger records the volume
identity. In the final 540 starts, quota P95 and maximum were both 2 ms.

One discarded diagnostic cohort mixed loaded and unloaded conditions because
the first load window expired after 36 samples. It is not included in the
qualification. That partial file contained one 5.872-second browser sample;
quota was 1 ms and lifecycle lock wait was zero, while `podman create` took
3.646 seconds during the initial direct-I/O pressure spike. The clean rerun
used a fresh 30-minute load window, verified emergency pressure before the
cohort, and completed all 108 samples with a 2.767-second maximum.

## Validation And Safety

- Focused quota and lifecycle tests: 51/51 passed.
- Full `project-host` package tests: 117/117 suites and 707/707 tests passed.
- `project-host` TypeScript build passed.
- The staging load driver rejects non-staging API origins, caps projects at
  32, caps duration at two hours, caps each data file at 256 MiB, and validates
  a per-process ownership token before signaling anything during cleanup.
- The 10,000-project corpus is host-ID-gated and reversible.
- Post-qualification cleanup deleted all 10,000 corpus rows and subvolumes in
  92.56 seconds, restored the baseline qgroup/subvolume counts, removed all
  load markers and files, and stopped all 20 benchmark/load projects.
- No production host, service, setting, or artifact was changed.

## Gate Assessment

- At least 500 eligible starts: pass (540).
- At least 100 samples per claimed scenario: pass (108 each).
- Browser-observed P95 at or below 3.0 seconds: pass in every scenario.
- State-propagation P95 at or below 250 ms: pass (57 ms combined).
- Quota P95 below 150 ms: pass (2 ms).
- Runner P95 at or below 1.5 seconds: pass (1.446 seconds combined; every
  scenario at or below 1.489 seconds).
- Zero unexplained samples above five seconds: pass (zero samples above five
  seconds in the qualified set).
- Zero start failures: pass.
- RootFS acquisition excluded and separately visible: pass.
- Lifecycle starvation under CPU and I/O load: not observed.
- Eviction/start churn: not observed; the qualification did not require
  eviction because enforced pool limits and reserved headroom preserved the
  service envelope.

The staging implementation is ready for production rollout review. Production
deployment remains a separate decision and should follow the phased rollout in
the strategy document.
