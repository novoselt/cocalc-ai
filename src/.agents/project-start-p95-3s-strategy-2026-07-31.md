# Project Warm-Start P95 Under Three Seconds

Date: 2026-07-31

Status: execution strategy; staging work is authorized, production deployment
requires separate review and approval

Related work:

- `src/.agents/project-host-quota-startup-scalability-plan-2026-07-30.md`
- `src/.agents/project-host-storage-scalability-staging-results-2026-07-30.md`
- `src/.agents/project-host-io-phase-2-plan-2026-07-29.md`
- `src/.agents/shared-host-stopping-eviction-spec-2026-04-29.md`

## Goal

Achieve a real user-observed P95 of at most three seconds from requesting a
warm project start until the browser observes the authoritative lifecycle state
`running`.

The eligible cohort is deliberately narrow and operationally meaningful:

- the project is already provisioned on its assigned host;
- the assigned host is running, healthy, and accepting starts;
- the project's RootFS is cached locally;
- no restore, migration, pending copy, or host wake-up is required;
- the browser is foregrounded and has a healthy control-plane connection; and
- the project is not already starting or running.

RootFS acquisition, restore, host startup, disconnected browsers, and
background-tab timer suspension must remain visible as separate metrics. They
must not be silently dropped or allowed to contaminate the warm-start SLO.

The project must not be declared running early to satisfy the target. Running
means that the container was launched and passed the existing lifecycle safety
checks. Terminal, Jupyter, exec, and application readiness remain separate
user-facing SLOs.

## Current Position

Production evidence after the storage-scalability rollout shows:

- browser-observed warm-start P50/P95 near 7.1s/22.7s;
- authoritative backend P50/P95 near 5.8s/9.3s for the same samples;
- project-state observation lag near 14s at P95, consistent with one missed
  immediate report followed by the fixed 15-second retry;
- quota validation near 1.1s/2.0s P50/P95;
- runner startup near 2.5s/3.5s P50/P95;
- `podman run` near 0.9s/1.3s P50/P95; and
- about 0.9s/1.4s P50/P95 of runner time not yet attributed to a subphase.

Staging has already demonstrated approximately two-second project-host starts
with 10,000 unrelated dormant projects and quota checks around 80ms. The goal
is therefore technically credible, but production P95 will require systematic
work across state propagation, the quota fast path, runtime launch, and host
contention policy.

## Operating Principles

1. Optimize the measured critical path, not a proxy or an average.
2. Preserve correctness, isolation, quota enforcement, and corruption guards.
3. Separate unavoidable preparation from ordinary warm startup.
4. Reserve host capacity for lifecycle work instead of hoping idle capacity is
   available.
5. Prefer bounded, reversible changes and one-variable experiments.
6. Treat sustained inability to meet the SLO as an admission or capacity
   problem, not only a code-performance problem.
7. Record staging evidence before each design decision and production gate.
8. Keep free service genuinely useful: membership priority may decide who
   yields during measured overload, but must not create an artificial
   permanently degraded execution lane while capacity is available.

## Strategy

### Phase 1: Make The SLO Trustworthy

Split the current aggregate into authoritative backend start, RootFS
acquisition, state propagation, and browser observation. Attach LRO phase
timings to browser events, record client connection/visibility context, and
retain enough wall-clock timing to distinguish a slow service from delayed
telemetry.

A successful start response must update authoritative project state directly.
The separate project-host status report remains useful for reconciliation, but
the normal success path must not wait for a 15-second retry. Failed immediate
reports should use short, coalesced, prioritized retries before falling back to
normal reconciliation.

Exit criterion: the dashboard can explain every slow eligible sample as
backend work, state propagation, or browser transport, and state-propagation
P95 is below 250ms in healthy staging tests.

### Phase 2: Establish A Cheap Normal Backend Path

Make unchanged quota validation a keyed desired/applied-ledger decision. A
warm start should perform no Btrfs mutation or broad observation when the
filesystem identity, volume identity, quota epoch, desired revision, and
applied revision already match.

Instrument the remaining control-plane gaps so queue wait, routing, RPC wait,
host execution, and post-start bookkeeping are distinct. Move nonessential
post-start work out of the lifecycle completion path where correctness permits.

Exit criterion: quota P95 below 150ms, no unexplained control-plane interval
above 100ms at P95, and authoritative pre-runner work fits within the SLO
budget under staging load.

### Phase 3: Reduce Runtime Launch Cost

Attribute all currently unmeasured runner time, especially existing-container
checks, conmon scanning, port allocation, runtime/network argument discovery,
Podman inspection, and cgroup attachment. Optimize only after attribution.

Start with low-risk fast paths: cache invariant runtime configuration, avoid
global process scans when local state proves the project stopped, and combine
or remove redundant Podman/cgroup round trips without weakening verification.

If fresh `podman run` cannot meet the budget reliably under contention, test a
configuration-hashed stopped-container fast path. Reuse a stopped container
only when image, mounts, ports, secrets contract, runtime bundle, network mode,
and resource configuration are compatible; otherwise recreate it. Pre-created
or warm containers are a later option, not the starting assumption.

Exit criterion: runner P95 at or below 1.5s under the qualified staging load
matrix, with no increase in failed starts, stale containers, port conflicts,
containment drift, or project readiness failures.

### Phase 4: Protect The SLO Under Contention

Reserve CPU, memory, I/O, and control-plane capacity for project lifecycle
operations. Foreground starts must outrank maintenance and ordinary background
work, while current corruption, quota, and containment guarantees remain
fail-closed.

Define host-local admission zones from measured CPU pressure, memory headroom,
I/O PSI, storage metadata/free-space state, lifecycle queue depth, and recent
start latency:

- normal: admit starts immediately;
- guarded: pause maintenance and throttle lower-priority running work;
- recovery: redirect or defer new low-priority starts and stop selected idle
  projects;
- emergency: reject starts that cannot be served safely and evict enough work
  to restore the host.

Eviction should prefer lower-priority, idle, older-running, and more
resource-intensive projects while protecting recent interactive activity,
active lifecycle operations, and a configurable startup window. Use hysteresis,
settle periods, and cooldowns to prevent churn. Shared and dedicated hosts may
need different policy profiles, but both must preserve host survival.

A lower-priority project receives the same available host capacity in normal
operation. It may be stopped only to recover from measured host pressure, not
merely because it is free or has run for a long time. The product must explain
that pressure stop, identify upgrading as a way to receive stronger overload
priority, preserve the project state, and restart automatically when the host
has recovered or the user requests it and admission is safe.

The tests must expose the product and cost tradeoffs explicitly: required idle
headroom, maximum running-project density, amount of throttling, eviction rate,
and any membership-priority consequences.

Exit criterion: the eligible start SLO remains below three seconds while the
host is intentionally busy but still inside its advertised service envelope.
When the envelope cannot be maintained, admission and eviction react before
latency or host health collapses.

## Staging Execution Loop

An agent may iterate autonomously on staging for several hours using this loop:

1. Capture an idle baseline and identify the largest current P95 phase.
2. Make one bounded change, add focused tests, and build a versioned artifact.
3. Deploy component-specifically to one staging host; preserve unrelated
   Conat, ACP, and project workloads whenever possible.
4. Run the same start corpus under idle and stressed conditions.
5. Compare phase distributions, failures, host pressure, and user readiness.
6. Keep the change only when it improves the target without violating safety;
   otherwise revert the staging artifact and record the result.
7. Repeat against the next bottleneck.

Permitted staging abuse includes:

- at least 10,000 dormant project rows, volumes, and qgroups using the existing
  host-ID-gated reversible corpus tooling;
- simultaneous CPU, memory, buffered-write, random-I/O, and metadata pressure;
- many running projects with mixed membership priorities;
- start bursts and start/stop churn;
- snapshot, backup, BEES, quota-audit, and deletion activity;
- delayed or failed state-report RPCs and Conat reconnects;
- project-host component restarts and operation recovery; and
- foreground and background browser/network conditions.

Tests must never use unbounded destructive load, consume the host's final disk
or metadata reserve, delete non-corpus data, or touch production. Every stress
driver needs explicit ceilings, cleanup, and a durable marker identifying its
test state.

## Qualification Gate

The staging result must include at least 500 eligible warm starts across idle,
busy, and recovery-pressure scenarios. Report P50, P90, P95, P99, maximum,
failure rate, and every phase distribution. No scenario or host cohort used for
the release claim should contain fewer than 100 samples.

Required acceptance criteria:

- eligible browser-observed P95 at or below 3.0s;
- authoritative backend P95 low enough to preserve a realistic network and
  state-propagation budget;
- state-propagation P95 at or below 250ms;
- zero unexplained samples above five seconds;
- zero data-loss, corruption, containment, quota, or cross-project isolation
  regressions;
- no lifecycle starvation from maintenance or running-project load;
- no eviction/start churn loop; and
- separate reporting for RootFS acquisition and ineligible client conditions.

The final staging report must state which capacity and QoS policy was required
to pass. A result obtained only by leaving most of a host idle is not a useful
shared-host qualification.

## Production Rollout

Production begins only after review of the implementation, staging evidence,
and the explicit cost/QoS tradeoffs.

Use a phased rollout:

1. one private or operator-owned host;
2. one representative shared host under known load;
3. a small multi-region cohort;
4. half the eligible fleet; and
5. the remaining fleet.

At each gate compare authoritative and browser-observed latency, state
propagation, start failures, eviction decisions, pressure, and terminal/Jupyter
readiness. Pause or roll back on correctness regressions, unexplained latency,
host-health degradation, or excessive eviction. Do not roll back durable state
formats without an explicit compatibility review.

Production will determine whether the three-second target is compatible with
the desired project density and cost model. If it is not, the final decision
must be explicit: buy more headroom, reduce density, throttle running work more
aggressively, evict sooner, relax the SLO for lower-priority service classes,
or adopt a stopped/warm-container architecture.
