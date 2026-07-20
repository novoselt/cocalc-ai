# Project-host paced rollout implementation

Date: 2026-07-20

## Incident and objective

Publishing a new global `project-host` artifact and component target caused every
online host watchdog to converge at approximately the same time. The resulting
heartbeat and route-probe gap made healthy, assigned projects display a false
host-unavailable banner. Fleet size makes this progressively worse.

The operational invariant is now:

> A project-host software deployment must be a durable, bay-authoritative,
> canary-first campaign. A global desired version is promoted only after every
> currently healthy host in that bay has run and stabilized on that version.

`software push project-host:<selector>` remains the publish-only operation.
The following deploy operations use the same paced campaign by default:

- `software deploy project-host:<selector> <profile>`;
- `software deploy host-conat-router:<selector> <profile>`;
- `software deploy host-conat-persist:<selector> <profile>`;
- `software deploy host-acp-worker:<selector> <profile>`; and
- `software deploy host-runtime-stack:<selector> <profile>`.

`--rollout` remains accepted for compatibility but is no longer required for
these components.

## Campaign model

`hosts.rolloutHostRuntimeFleet` creates a durable
`host-runtime-fleet-rollout` LRO. The initial implementation is deliberately
bay-local. The API rejects missing, unhealthy, mixed-bay, or remote cohorts.
When global promotion is requested, it also rejects a cohort that omits any
currently healthy local host.

One primary bay worker claims at most one campaign. It:

1. selects and installs the shared project-host artifact on exactly one canary
   using the existing per-host upgrade LRO;
2. restarts project-host only when that artifact changed, then invokes the
   existing managed-component LRO for the selected auxiliary services;
3. observes the target artifact, every requested component, project-host
   health, and rollback state continuously for the configured canary interval;
4. upgrades later hosts in bounded waves, with a separate stabilization
   interval after each wave;
5. stops immediately after any failed child LRO, unhealthy observation, or
   automatic rollback;
6. atomically promotes the artifact, project-host, and only the selected
   auxiliary components after the complete cohort succeeds; and
7. removes only matching temporary host-level overrides, preserving unrelated
   host-specific runtime pins.

Component execution order is project-host artifact activation, Conat router,
Conat persist, then ACP worker. ACP uses its nondisruptive drain-and-replace
policy; the Conat services use restart-now. Reusing the current artifact for an
auxiliary-only campaign does not restart project-host.

The global upserts and temporary override cleanup are one PostgreSQL
transaction. Promotion therefore cannot be partially applied if cleanup or the
worker fails.

Progress and completed host results are stored in the parent LRO so a worker
restart resumes after already successful hosts rather than restarting the whole
campaign. Existing per-host local rollback remains the rollback authority.

Defaults are one canary, two hosts per later wave, 180 seconds of canary
stability, and 60 seconds after each later wave. Operators can tune these with:

```bash
cocalc software deploy \
  --rollout-canary <host> \
  --rollout-max-concurrent 2 \
  --rollout-canary-stabilize-seconds 180 \
  --rollout-stabilize-seconds 60 \
  project-host:<tag> <profile>
```

The lower-level command is:

```bash
cocalc host deploy rollout-fleet \
  --all-online \
  --desired-version <artifact-id> \
  --component conat-router \
  --component conat-persist \
  --canary <host> \
  --max-concurrent 2 \
  --canary-stabilize-seconds 180 \
  --stabilize-seconds 60 \
  --base-url <software-base-url> \
  --wait
```

## Availability behavior

Every per-host project-host upgrade records a bounded planned-transition marker
before installation starts. Failures, cancellations, rollbacks, and upgrades
that do not schedule a daemon restart remove the matching marker when the child
operation finishes. A successful scheduled restart retains the marker until a
replacement host session reports runtime ready. While active:

- ordinary operational availability remains false, so the host receives no new
  project placement;
- assigned-project connection authorization ignores transient heartbeat,
  runtime-health, and public-route failures for at most three minutes, avoiding
  a false outage banner during the expected daemon replacement; and
- availability observations are classified as planned maintenance rather than
  an unplanned incident.

The marker has a ten-minute hard deadline. A transition that runs beyond the
three-minute UI grace becomes visible as a real outage. A crashed worker cannot
suppress health indefinitely.

`metadata.runtime_deployments` is hub-owned. Host registration and heartbeat
upserts atomically preserve the current database subtree instead of accepting a
stale copy from the restarting daemon. Marker cleanup is operation-id guarded,
and the recorded prior host session prevents the old daemon's final healthy
heartbeat from completing a transition intended for its replacement.

## Failure semantics

- A canary failure prevents every later host from starting.
- A failure in a later wave prevents every later wave from starting.
- Global desired state is unchanged after a failed or canceled campaign.
- A host omitted because it is offline receives the promoted global default
  when it later reconnects; currently healthy hosts cannot be omitted from a
  promotion.
- Publishing an artifact alone cannot trigger watchdog convergence.
- Direct fleet rollout is fresh-auth protected.

## Staging validation performed

Validation used the two healthy staging hosts `host2` and `host`.

1. An invalid-artifact canary failed on download. The second host did not start,
   both hosts retained their versions, and global desired state was unchanged.
2. The real artifact
   `20260720T174757Z-7538ce85-project-host-paced-rollout-20260720` first exposed
   and then covered the distinction between artifact ID and internal build ID.
3. Campaign `5b9d33e2-cd5f-44b5-b1ff-d854d28ace40` upgraded the canary and only
   started the second host after canary completion and stabilization. Atomic
   promotion removed only project-host overrides and retained an unrelated
   host-specific tools pin.
4. A controlled downgrade exposed two marker lifecycle races: shallow host
   metadata replacement and child completion preceding the scheduled daemon
   restart. Both received regression tests and hub-only staging deployments.
5. Final campaign `fa509eac-ee6b-4dd5-8533-3d7f149ade7c` upgraded `host2` as
   canary, observed 20 seconds of continuous health, then processed `host` and
   observed 10 seconds before atomic promotion.
6. The canary's replacement session was recorded as planned maintenance from
   `18:21:55.547Z` through `18:22:01.737Z`. The marker included the prior and
   replacement session IDs, survived the starting registration, and was absent
   after the ready heartbeat.
7. All 80 direct project command probes succeeded from `18:21:38Z` through
   `18:23:41Z`, spanning the canary restart and second-host wave.
8. The final project-host software smoke passed representative-host selection,
   deployment observation, and rootfs RPC checks. Both hosts were running with
   fresh ready heartbeats, no transition marker, no project-host override, and
   the target artifact/component version.
9. Commit `c8432de91f` generalized the same campaign to all four managed
   components and was deployed hub-only as staging release
   `20260720190654-hub`; no project-host or host-side service changed during the
   control-plane deployment.
10. ACP campaign `6b47c9f8-da7e-47b9-830e-98d180275711` rolled `host2` and
    then `host`. Only ACP PIDs changed; project-host, router, and persist PIDs
    remained stable. ACP aligned on both hosts, its global policy was promoted
    as `drain_then_replace`, and all concurrent project probes succeeded.
11. Conat campaign `b9f50ccb-50c3-471e-8e9a-5fe3bb565ee2` rolled router and
    persist together in canary/wave order. Project-host and ACP PIDs remained
    stable, both Conat services aligned, and promotion preserved the unrelated
    host2 tools pin. One 15-second project-exec probe timed out on each host
    during that host's Conat restart; the other host remained available and the
    next probe on the restarted host succeeded. Conat service rollouts are thus
    fleet-safe but not connection-disruption-free for the host being updated.
12. The operator-facing `software deploy host-acp-worker` path created campaign
    `2f7ef40a-2a93-4ec4-b093-9b70690b7857` as a single subprocess. It completed
    both hosts with no failed project probes, proving the high-level command no
    longer performs the old immediate-global set/reconcile sequence.

Production should use the default 180/60-second observation windows unless
staging reveals a reason to lengthen them.
