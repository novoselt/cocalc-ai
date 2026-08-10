# Project-host Btrfs I/O pressure staging results (2026-08-04)

## Conclusion

Keep Btrfs. The severe stalls were caused by low nested `io.max` limits, not by an intrinsic Btrfs throughput limit. Metadata-heavy processes could hold filesystem-wide Btrfs resources while their cgroup was throttled, creating a priority inversion that also blocked high-priority Podman startup.

The candidate removes those low ceilings from Btrfs project and BEES scopes while retaining finite 10% device headroom. It preserves strict limits for maintenance and the ext4 scratch disk. Staging testing on a spot `t2d-standard-16` with a 325 GB balanced PD reduced the exact workload's warm-start P95 from 12.36 seconds to 2.93 seconds.

Production was not changed.

## Candidate

- Branch: `fix/project-io-pressure-attribution`
- Worktree: `/home/user/cocalc-ai-io-pressure-fix`
- `1a0a04ae7c`: Btrfs headroom policy and direct per-project I/O PSI attribution
- `4f3a820021`: privileged helper schema rollout correction
- `91829ce66a`: prevent throttled BEES from becoming a Btrfs lock holder

The `gcp-pd-balanced-btrfs-headroom` profile applies 90% of provider-derived physical capacity to Btrfs project, lifecycle, startup, and BEES cgroups. It continues to use low I/O weight, nice/idle scheduling, CPU limits, and direct-offender eviction for fairness. Maintenance remains tightly capped. The ext4 scratch disk retains the existing pool, tier, and pressure-mode limits.

The pressure controller now samples each project's cgroup full-I/O PSI. Sustained host and project-pool pressure can be attributed even when the old `uncontained` subtraction is zero. A direct tier-zero offender can bypass idle, startup, cooldown, and protect gates; active higher-priority projects remain protected.

## Exact reproduction

The controlled offender ran:

```bash
sudo apt-get update
sudo env DEBIAN_FRONTEND=noninteractive apt-get install -y \
  xfce4 xfce4-goodies dbus-x11
```

The benchmark repeatedly stopped and started a separate warm project on the same host.

| Policy                            | Starts |    P50 |     P95 |     Max | Host full-I/O stall |
| --------------------------------- | -----: | -----: | ------: | ------: | ------------------: |
| Old standard leaf, 309 write IOPS |     15 | 2.872s | 12.364s | 12.364s |              32.48% |
| No Btrfs `io.max` counterfactual  |     10 | 2.847s |  2.883s |  2.883s |               0.91% |
| Candidate, finite 90% headroom    |     30 | 2.905s |  2.928s |  2.929s |               2.55% |

Under the old standard policy, leaf full PSI reached 92.43%, pool full PSI 93.23%, and host full PSI 84.12%. Under the candidate, their maxima were 13.62%, 14.79%, and 8.32% respectively.

## Adverse tests

- A single 4 KiB random direct-I/O project drove pool full PSI to 34-45% and host full PSI to about 29%. The new profile correctly entered `emergency` despite `uncontained=0` and attributed about 3,300 write IOPS to that project.
- After the existing two-minute dwell, the controller reported no stop candidate because the staging owner has paid shared-compute priority and the project was actively working. This is the intended protection path. Tier-zero direct-offender selection and one-stop-per-cycle behavior are covered by focused unit tests.
- During the same direct-I/O saturation, 20 warm starts had P50 2.917s, P95 2.936s, and one 3.955s maximum.
- Pressure mode `protect` did not reduce Btrfs limits, but continued to reduce ext4 scratch write capacity. Returning to `normal` restored the ext4 limits.

## BEES finding

The first post-bootstrap check found a second instance of the same priority inversion. BEES was at 98% full PSI inside its legacy 16 MiB/s cgroup, the project pool was at 0%, and a project start was blocked. Removing that cap caused host full PSI to decay from over 80% to zero without stopping BEES.

The final v39 helper gives BEES the same finite Btrfs headroom envelope as the project pool while preserving `io.weight=1`, idle I/O scheduling, nice 19, and a four-core ceiling. A forced scan of the new generation reported a 14.008 GiB cycle completing in about two seconds with BEES full PSI at zero. The test-data cleanup completed in 2.79 seconds.

## Staging state

- Host: `io-europe-balanced` (`e10bf532-a259-4e0e-a66c-c11687aa6f9d`)
- Project-host artifact: `20260804T071358Z-1a0a04ae-btrfs-headroom`
- Bootstrap artifact: `20260804T074307Z-91829ce6-btrfs-headroom-v3`
- Installed helper schema: `20260804-v39`
- Effective Btrfs cap: 4,455 read/write IOPS, 217,998,950 B/s read, 188,743,680 B/s write
- All load projects are stopped; pressure mode is `normal`; host full PSI was zero at cleanup

The host has a local policy override because the shared staging hub still generates the prior profile. A real rollout must include the `bootstrap-host.ts` server change, then the v39 bootstrap helper, then the candidate project-host artifact. Do not deploy only one layer.

## Validation

- Project-host focused Jest: 18 tests passed
- Server bootstrap-host Jest: 27 tests passed
- Python bootstrap suite: 77 tests passed
- Project-host and server package typechecks passed
- Full repository development build passed
- One unrelated full project-host-suite test hit the known shared SQLite `database is locked` failure; all focused changed tests passed

## Recommendation

After review, canary the complete three-layer rollout on one production host. Verify the profile, pool/project/BEES `io.max`, helper schema v39, and direct-project PSI telemetry before expanding. Roll out one host at a time and compare warm-start P95, host/pool full PSI, pressure actions, Podman probe health, and BEES pressure against an unchanged host.
