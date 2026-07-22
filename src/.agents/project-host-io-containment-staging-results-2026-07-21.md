# Project Host I/O Containment Staging Results

Date: 2026-07-21

Production status: unchanged. No production I/O policy was enabled.

## Deployed Staging State

The two active shared staging hosts run project-host artifact
`20260721T091258Z-befa1c49-io-containment-v9` and bootstrap artifact
`20260721T091038Z-befa1c49-io-containment-v8`.

Both hosts report:

- policy mode `enforce` and capability `validated`;
- profile `staging-gcp-pd-balanced-conservative`;
- capacity source `operator-conservative-staging-test`;
- Btrfs on `/dev/sdb`, discovered dynamically as `8:16`;
- scheduler `none`;
- pool limit `rbps=67108864 wbps=33554432 riops=2000 wiops=1000`;
- zero processes in the legacy project cgroup.

The staging leaf classes are:

| Class    | Read B/s | Write B/s | Read IOPS | Write IOPS | Weight |
| -------- | -------: | --------: | --------: | ---------: | -----: |
| standard | 16 MiB/s |   8 MiB/s |       500 |        250 |    100 |
| member   | 32 MiB/s |  16 MiB/s |     1,000 |        500 |    200 |
| premium  | 48 MiB/s |  24 MiB/s |     1,500 |        750 |    400 |

These are conservative staging values, not proposed production defaults.

## Measured Containment

Every injected workload PID was verified in its project leaf before the
measurement started.

- A 256 MiB direct write under the standard leaf took 32 seconds, matching the
  8 MiB/s write ceiling.
- Three simultaneous standard direct writers each charged about 537 MB and
  completed in 65 seconds, again matching 8 MiB/s per leaf. The control
  project's command latency remained 109-197 ms.
- With three leaves temporarily raised to 24 MiB/s, three simultaneous 1 GiB
  direct writes completed in 97-98 seconds. Their approximately 31.3 MiB/s
  combined rate reached the 32 MiB/s parent ceiling, proving hierarchical
  aggregate enforcement.
- 10,000 direct 4 KiB writes completed in 41 seconds: approximately 245 IOPS
  against a 250 IOPS standard ceiling. Control latency remained below 179 ms.
- A 512 MiB direct read completed in 32 seconds, matching the 16 MiB/s standard
  read ceiling.
- 10,000 random `O_DIRECT` 4 KiB reads completed in 19 seconds: approximately
  526 IOPS with one-second timing granularity against a 500 IOPS ceiling.
- Service-class reconciliation produced the exact member and premium limits
  above. An unknown class was rewritten to `standard` and received the
  conservative standard limits.

## Five-Million-File Test

A contained project created 5,000,000 files across 500 directories. The same
tree was removed through `cocalc-runtime-storage sandbox-rm`, the privileged
path used by production file operations.

- The deletion helper PID was verified in the triggering project's leaf.
- Deletion took 737 seconds under the standard ceiling.
- Aggregate project-pool I/O PSI repeatedly exceeded 90%.
- An unrelated project's direct file listing remained at or below 24 ms over
  365 samples.
- Project-host and host control services stayed alive.
- The tree was completely removed.

Podman `exec` itself experienced a roughly 35-second outlier during peak Btrfs
metadata pressure. Direct project file access and local project-host HTTP
remained responsive. This distinguishes a Podman global-state bottleneck from
failure of the steady-state project data path.

## Reboot and Recovery

Host2 was rebooted through the staging control plane. Its ephemeral public IP
changed. Bootstrap automatically rediscovered the data device, restored the
pool cap, restored active leaf caps, and reported zero legacy processes.

The reboot exposed a Bash parser bug: new trailing policy identity fields were
initially absorbed into the final `io_class` variable. Commits `ae35d66376` and
`befa1c4918` fixed the parser. Commit `84c43ad260` made reconciliation rewrite
malformed state, and the v8 helper verified all active and stopped project
class files are canonical nine-byte `standard` values where expected.

## Failure and Rollback Tests

- An enforce policy with `pool.wiops=0` failed with
  `project-io-policy-invalid` and left the previous live aggregate cap intact.
- Changing mode to `disabled` removed every pool and leaf `io.max` entry
  without reboot.
- Restoring enforce mode rediscovered the device and restored and verified the
  original limits without reboot.
- The helper-only bootstrap rollout updated privileged policy code without
  restarting project-host, Conat, ACP, or project containers.

## Telemetry

The hub metrics history persists the complete I/O containment snapshot,
including policy identity and capacity provenance, effective pool limit and
weight, devices and scheduler, pressure totals and percentages, bounded leaf
rates, stale/truncated counts, and legacy process count.

The sampler handled the active staging projects without truncation. It is
bounded to 32 leaves per interval for larger hosts.

## Explicit Limitations Before Production

- `io.weight` fairness is not claimed. The current GCP scheduler is `none` and
  `io.cost` remains disabled. Hard `io.max` ceilings are the safety boundary.
- The durable project-host fleet campaign's public-route probe still timed out
  for both staging hosts even after the managed Cloudflare-proxy route returned
  quickly from an external client. The two hosts were therefore upgraded
  sequentially with explicit host-agent operations; the campaign gate was not
  bypassed or weakened.
- The privileged recursive deletion work is attributed and independently
  killable, but live delete still waits for completion and snapshot pruning
  does not yet have the durable operation journal and transition-by-transition
  crash recovery specified in Phase 2.
- Multi-device Btrfs, device reattachment, Nebius, unsupported-controller, and
  snapshot quota/read-only failure-injection tests remain outstanding.
- A 24-hour all-staging soak has not elapsed yet.

The static containment boundary has strong staging evidence and directly
addresses the host-wide failure mode from ordinary user I/O. Phase 2's durable
snapshot-operation work is a separate correctness requirement and must not be
represented as complete by these results.
