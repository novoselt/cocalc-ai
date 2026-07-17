# BEES production-data experiment, 2026-07-17

## Purpose

Determine whether CoCalc's current BEES configuration is reclaiming useful
space, whether the 1 GiB hash table is appropriately sized, and how BEES can
use idle project-host resources without competing with projects.

The experiment used independent balanced-PD clones of the 400 GiB Btrfs data
disk from `los-angeles-1`. No experiment changed the live filesystem or live
BEES process. The live host was inspected read-only.

## Source filesystem

- Btrfs device size: 429,496,729,600 bytes (400 GiB)
- Btrfs data used at snapshot: 339,502,735,360 bytes
- Btrfs metadata used at snapshot: 10,477,322,240 bytes, DUP profile
- Subvolumes: 4,820
- Snapshot subvolumes: 3,771
- BEES tracked data: 328.008 GiB
- BEES hash table: 1 GiB, about 67 million cells, 99% occupied
- Production BEES binary: `70d69f5`, from the `sagemathinc/bees-binaries`
  repository
- Production command: `bees -v 1 -g 1 /mnt/cocalc`

The table being full is normal LRU behavior and does not indicate that it is
undersized. At 1 GiB for about 328 GiB of tracked data, the table is roughly 30
times larger per byte of data than BEES's general 1 GiB-per-10-TiB rule. A
larger table would consume more locked RAM without a credible expected gain.

## Live-host observation

At the time of inspection, the live process had run for 16.7 hours and used
one CPU continuously. Its cgroup configuration was:

- `cpu.max=100000 100000`, a hard one-core ceiling
- `cpu.weight=1`
- `io.weight=1`
- no memory high or maximum

The cgroup was throttled in 99.6% of CPU quota periods. The process continuously
wanted more CPU than the cgroup allowed.

The BEES hourly statistics at 20:22 and 21:22 both reported exactly
9,143,186,929 deduplicated bytes. BEES therefore reclaimed no additional data
during that reported hour despite consuming one CPU and scanning about 18.8
MB/s. Its long-run average fell from 168,354 B/s to 157,840 B/s as uptime
increased without additional deduplication.

This is a zero-yield crawl condition, not evidence that there are no remaining
duplicates. Restarting the same production binary against an identical clone
immediately reclaimed data.

## Clone results

All rates below use changes in `btrfs filesystem usage -b`, not only BEES's
logical counters. Device error counters stayed at zero in every trial.

| Trial                        | Starting state             | Duration |         CPU |  Read rate |  Data reclaimed | Reclaim rate | Metadata delta |
| ---------------------------- | -------------------------- | -------: | ----------: | ---------: | --------------: | -----------: | -------------: |
| Current upstream, 16 workers | Fresh snapshot             |   10m33s | 15.21 cores | 87.0 MiB/s | 6,942,949,376 B |   10.97 MB/s |   +3,342,336 B |
| Current upstream, 4 workers  | After 16-worker trial      |   10m17s |  3.97 cores | 16.8 MiB/s | 2,406,584,320 B |    3.90 MB/s |   +3,293,184 B |
| Production binary, 4 workers | After preceding trials     |    5m16s |  3.91 cores | 49.5 MiB/s | 1,644,158,976 B |    5.20 MB/s |  +18,038,784 B |
| Production binary, 4 workers | Independent fresh snapshot |   10m17s |  3.96 cores | 17.4 MiB/s | 1,587,372,032 B |    2.57 MB/s |   +2,211,840 B |

The independent production-binary trial is the fair comparison with the live
host. It reclaimed data about 16 times faster than the live daemon's reported
long-run rate. The short tests vary because different crawl regions have very
different duplicate density.

The unrestricted 16-worker run populated about 59 GiB of clean file cache.
The process RSS remained near 1.1 GiB and `MemAvailable` remained high, so this
was reclaimable cache rather than a leak. It can still evict useful project
cache and should be bounded.

## Scheduling isolation test

BEES was placed in a transient cgroup with a four-core ceiling, CPU weight 1,
and nice level 19. A normal-priority sibling cgroup then ran sixteen CPU-bound
workers.

| Phase                      |   BEES CPU |
| -------------------------- | ---------: |
| Idle host                  | 3.67 cores |
| Normal-priority saturation | 0.16 cores |
| After saturation ended     | 3.84 cores |

The low-weight policy allows BEES to use idle cores but yields promptly when
normal work needs the host. This is substantially safer than merely raising
the existing hard CPU quota.

## Bounded-cache and I/O test

A later, non-comparable crawl segment was run with:

- four-core ceiling
- CPU and I/O weight 1
- nice level 19
- `memory.high=4 GiB`
- `memory.max=8 GiB`
- read ceiling 64 MiB/s
- write ceiling 16 MiB/s

Over 5m17s it reclaimed 574,398,464 bytes of data while adding 2,670,592 bytes
of metadata. It averaged 3.49 cores and 24.8 MiB/s reads. Memory reached the
4 GiB high watermark and was reclaimed there. There were no maximum-memory,
OOM, or device-error events. The maximum observed read rate was exactly the
configured 64 MiB/s ceiling.

These limits successfully bound cache and I/O without preventing useful work.
The throughput cannot be compared directly with the fresh trial because this
run occurred later in the crawl.

## Binary version

Production is 19 upstream commits behind the current BEES checkout. The most
relevant performance change is upstream `94c1314`, which removes duplicate
full-range reads performed on every successful dedupe. Other intervening
changes include extent-task limits, a maximum-extent kernel workaround, and
scanner fixes.

The exact production binary performed useful work after restart, so an upgrade
is not required to fix the zero-yield condition. Updating remains worthwhile
after building a new `sagemathinc/bees-binaries` release and validating it on
staging.

## Recommended policy

### 1. Keep the 1 GiB table

Do not enlarge the hash table. It is already generous for this filesystem and
is locked into RAM. Testing a smaller table could save RAM, but that is lower
value than fixing crawl scheduling and resource isolation.

### 2. Give BEES a dedicated cgroup

Do not share the general `cocalc-storage` cgroup with backups and other storage
maintenance. For a 16-core, 64-GiB project host, start with:

- maximum four CPUs
- CPU weight 1 and nice level 19
- I/O weight 1
- 64 MiB/s read ceiling
- 16 MiB/s write ceiling
- 4 GiB memory high watermark
- 8 GiB memory maximum
- a small finite PID limit, for example 64

Scale CPU and memory limits down on smaller hosts rather than assuming all
project hosts have 16 cores and 64 GiB RAM.

Run BEES with an explicit four-worker maximum. Do not rely on `-g 1`: the live
load-target behavior plus the hard one-core cgroup produced continuous
throttling and poor progress.

### 3. Recycle zero-yield crawls

Do not leave one BEES process running forever without progress supervision.
Monitor the hourly `beesstats.txt` updates and cgroup CPU usage. Gracefully
restart BEES when two successive fresh statistics snapshots show no increase
in `dedup_bytes` while BEES consumed significant CPU. Apply a per-host cooldown
and stable jitter so the fleet does not restart simultaneously.

A simpler first canary is a bounded restart every six hours. Startup took
about 15 seconds and graceful stop took one to two seconds in these trials.
Progress-aware recycling is preferable because it avoids restarting a daemon
that is still productive.

### 4. Update BEES separately

Create a new release from current upstream in `sagemathinc/bees-binaries`, pin
the new release and checksum, then compare old and new binaries on independent
snapshot clones. Keep the resource-policy rollout separate from the binary
upgrade so regressions can be attributed and rolled back independently.

## Staged rollout

1. Add status telemetry without changing behavior: cgroup CPU/IO/memory,
   `beesstats.txt` timestamp and dedup delta, crawl progress, and Btrfs
   data/metadata usage.
2. Deploy the dedicated bounded cgroup and four-worker policy to a staging
   project host.
3. Test foreground CPU and project file/exec latency while BEES is active.
4. Canary one low-risk production host for at least 24 hours.
5. Compare reclaimed bytes per CPU-hour, project latency, cache pressure,
   metadata growth, and device errors with an unchanged host.
6. Add progress-aware recycling and canary it separately.
7. Build and canary the upstream BEES upgrade as a final independent change.

## Risk controls

- Never run experimental BEES settings first on the only copy of user data.
- Compare table sizes or binaries only on independent clones from one snapshot;
  sequential runs are biased because each run mutates the extent layout.
- Track metadata as well as data. Snapshot-heavy filesystems can incur metadata
  growth during deduplication.
- Keep the existing minimum scheduling weights and explicit bandwidth limits.
- Stop a canary on device errors, metadata pressure, OOM events, or measurable
  project latency regression.
