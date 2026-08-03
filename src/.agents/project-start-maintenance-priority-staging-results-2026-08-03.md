# Project Start Maintenance-Priority Staging Results (2026-08-03)

## Scope

This qualification covers commits:

- `81f737e118`: keep background Btrfs discovery in the maintenance cgroup, run short lock-held transactions at normal priority, recheck admission after lock acquisition, replace periodic all-project quota repair with a persisted dirty/due audit ledger, and defer snapshot/backup/storage scans around lifecycle pressure.
- `0aa0fdcd67`: provision a previously unknown home volume before first-start quota validation, and do not evict unrelated projects for lifecycle-only uncontained I/O when the project pool itself is healthy.

Artifact: `20260803T203240Z-0aa0fdcd-storage-lifecycle-v2`.

All three staging project hosts were promoted and healthy on this artifact. The primary scalability host was `io-europe-balanced`, a GCP spot `t2d-standard-16` with a 325 GB balanced persistent disk and a 100 GB balanced scratch disk.

## Correctness

- Project-host typecheck passed.
- All 118 project-host test suites passed: 725 tests total.
- A metadata-only project was created and immediately started. Its Btrfs home was created in 66 ms, its durable `project_volumes` identity was persisted, and quota lookup occurred afterward. Repeated starts used the persisted identity rather than recreating the volume.
- The exact reported regression was reproduced with `rootfs build cocalc-base --detach`. Once every staging host ran the artifact, the command created builder project `6605fea9-2167-4583-9fbb-2ced61653bfc`, started it, and launched build `rb-20260803T204733573-ee6d4a47` successfully in 6.3 seconds. The build was then canceled and the builder stopped.
- The first exact rootfs retry failed only because automatic placement selected `host2` before that host had received the artifact. This confirmed that the old artifact reproduced the bug and that mixed staging versions can invalidate this test.

## Scale And Load

The scalability host contained 10,000 synthetic project subvolumes and SQLite inventory rows, for 10,019 assigned projects during measurement. The mixed-load cohort used eight CPU burners, three buffered-I/O writers, four concurrently cycled benchmark projects, and scheduled host maintenance.

| Scenario                          | Samples | Browser P50 | Browser P95 | Browser max | Backend P95 | Failures |
| --------------------------------- | ------: | ----------: | ----------: | ----------: | ----------: | -------: |
| 10K inventory, CPU + buffered I/O |     100 |     2.344 s |     2.751 s |     3.125 s |     2.553 s |        0 |
| New-volume follow-up warm starts  |      10 |     2.290 s |     2.671 s |     2.671 s |     2.518 s |        0 |
| Synthetic corpus reclamation tail |       5 |     1.942 s |     2.010 s |     2.010 s |     1.828 s |        0 |
| Post-cleanup final                |      20 |     1.974 s |     2.085 s |     2.255 s |     1.936 s |        0 |

The scheduled snapshot/backup sweep fired at `2026-08-03T20:50:05Z` during the final cohort and deferred itself because storage admission was in recovery. It did not compete with lifecycle work.

The synthetic corpus cleanup removed all 10,000 subvolumes and rows in 70 seconds, including 55 seconds of qgroup cleanup. The host returned to 19 assigned projects, zero running projects, zero current host/project-pool/uncontained I/O PSI, and normal/recovery admission hysteresis.

## Production Incident Finding

The `us-south-2` `no_candidates` alert was caused by a managed RootFS restore, not memory exhaustion. A 167 MB archive expanded to 20.8 GB over 150 seconds and generated lifecycle-owned uncontained I/O. The old pressure policy stopped five unrelated projects and then exhausted candidates even though those stops could not relieve lifecycle I/O. The follow-up policy now keeps this lifecycle-only condition observe-only when project-pool PSI is below the eviction threshold; real project-pool, memory, and resource pressure remain enforceable.

## Result

The staging target is met: warm, already-provisioned, no-rootfs-pull browser-observed P95 remained below 3 seconds under the 10K inventory and mixed CPU/I/O workload. Fresh-volume ordering and the exact RootFS builder regression are both fixed. No production deployment was performed during this qualification.
