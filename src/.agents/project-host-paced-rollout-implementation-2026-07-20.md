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
`software deploy project-host:<selector> <profile>` performs the paced rollout;
`--rollout` remains accepted for compatibility but is no longer required for
`project-host`.

## Campaign model

`hosts.rolloutHostRuntimeFleet` creates a durable
`host-runtime-fleet-rollout` LRO. The initial implementation is deliberately
bay-local. The API rejects missing, unhealthy, mixed-bay, or remote cohorts.
When global promotion is requested, it also rejects a cohort that omits any
currently healthy local host.

One primary bay worker claims at most one campaign. It:

1. upgrades exactly one canary using the existing per-host upgrade LRO;
2. observes the target artifact, running component version, and rollback state
   continuously for the configured canary interval;
3. upgrades later hosts in bounded waves, with a separate stabilization
   interval after each wave;
4. stops immediately after any failed child LRO, unhealthy observation, or
   automatic rollback;
5. promotes the artifact and component as the global desired version only after
   the complete cohort succeeds; and
6. removes only the temporary host-level project-host artifact/component
   overrides, preserving unrelated host-specific runtime pins.

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
  --canary <host> \
  --max-concurrent 2 \
  --canary-stabilize-seconds 180 \
  --stabilize-seconds 60 \
  --base-url <software-base-url> \
  --wait
```

## Availability behavior

Every per-host project-host upgrade records a bounded planned-transition marker
before installation starts and removes the matching marker in a `finally`
block. While active:

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

## Failure semantics

- A canary failure prevents every later host from starting.
- A failure in a later wave prevents every later wave from starting.
- Global desired state is unchanged after a failed or canceled campaign.
- A host omitted because it is offline receives the promoted global default
  when it later reconnects; currently healthy hosts cannot be omitted from a
  promotion.
- Publishing an artifact alone cannot trigger watchdog convergence.
- Direct fleet rollout is fresh-auth protected.

## Staging validation

Before production, validate both negative and positive paths:

1. Publish/deploy the hub containing the campaign API and worker.
2. Use at least two healthy staging project hosts.
3. Queue an invalid, non-promoting canary campaign. Verify the canary fails,
   no later host changes version, the parent LRO fails, and global desired state
   is unchanged.
4. Deploy a real project-host artifact with short staging observation windows.
5. Verify only the canary changes first, then each bounded wave; the global
   desired state changes only after all hosts pass.
6. During the canary daemon replacement, verify an existing project terminal
   remains usable and no false host-unavailable banner appears.
7. Verify the host is excluded from new placement while its planned marker is
   active and that the marker is removed afterward.
8. Verify artifact/component observations, last-known-good versions, heartbeat,
   route probe, synthetic probe, and fleet LRO result after completion.

Production should use the default 180/60-second observation windows unless
staging reveals a reason to lengthen them.
