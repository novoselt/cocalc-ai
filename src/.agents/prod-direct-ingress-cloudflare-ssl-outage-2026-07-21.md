# Production Direct-Ingress Cloudflare SSL Outage

Date: 2026-07-21

Status: root cause confirmed; production restored to tunnels; recurrence fix
implemented but not deployed.

## Impact

Nine of ten monitored production project-host browser routes timed out. Users
could not reliably open projects, terminals, or other steady-state project
data paths. Host-local origin probes remained healthy, which made the outage
look like a fleet-wide transport failure rather than failed project-host
daemons.

The confirmed outage began at approximately 09:14 UTC and production was
restored to Cloudflare tunnels at approximately 14:02 UTC.

## Root Cause

Production and staging share the Cloudflare `cocalc.ai` zone. That zone's
default SSL setting is `flexible`, unchanged since 2023-04-25. Direct
project-host origins terminate HTTPS and therefore require a matching
Cloudflare configuration rule that sets origin SSL mode to `full`.

The direct-ingress implementation managed one shared rule:

- ruleset: `aeddf9c4bbf24737ae0a6fc7ed83b60a`
- rule: `19954c2712f34dccafd6ef92c4a762a1`
- ref: `cocalc_project_host_direct_tls`

Its expression was deployment-specific. Every host migration found the rule
by the shared ref or description and PATCHed it with that deployment's host
suffix. Consequently, the last staging or production migration won for the
entire shared zone.

At 09:14:15 UTC, the staging token changed the rule from the production suffix
to the staging suffix. Production hostnames immediately stopped matching the
only `ssl=full` override. Cloudflare then used the zone's `flexible` default for
production hostnames, attempted unencrypted HTTP to HTTPS-only direct origins,
and public project-host routes timed out. The origins themselves remained
healthy.

This was a control-plane configuration collision, not a simultaneous failure
of nine independent project hosts.

## Timeline

All times are UTC on 2026-07-21.

- 04:41:25: the legacy shared rule matched the staging host suffix.
- 06:43:04: API token `prod-cocalc-ai`, from `34.0.141.177`, PATCHed the
  shared rule to match `-cocalc-prod.cocalc.ai`.
- 06:43-07:14: production direct-host migrations repeatedly PATCHed the same
  already-equivalent rule while moving DNS to direct A records.
- 09:14:15: API token `cocalc-ai-staging-2`, from `34.0.143.203`, PATCHed the
  shared rule from the production suffix to `-cocalc-staging.cocalc.ai`.
- 09:15:08: staging PATCHed the same rule again.
- 09:16:33: fleet monitoring reported nine public-route timeouts while all
  corresponding host-local origin probes reported healthy.
- Approximately 14:02: production was restored to Cloudflare tunnels and
  project access recovered.

The Cloudflare v1 and v2 audit APIs independently identify the ruleset writes,
actor IPs, API token names, and successful PATCH responses. The v1 event also
contains the exact old and new expressions.

## Excluded Causes

- The earlier us-south-1 storage-pressure incident and host reboot were
  host-local. They cannot explain nine geographically distributed origins
  failing together while local health checks passed.
- Direct TCP 443 from an arbitrary laptop is not a valid origin check when the
  GCP ingress firewall is restricted to Cloudflare edge ranges.
- Project-host public-route monitoring and cloudflared recovery started after
  the public failures. A staging failure injection also showed that restarting
  cloudflared did not permanently rewrite a direct DNS route. Those actions
  did not initiate this outage.
- The host daemons, event loops, and local HTTPS routers were responsive in the
  alert diagnostics. Their health does not compensate for the wrong
  Cloudflare origin protocol.

## Recurrence Prevention

Commit `7dbaa3f20d` replaces the vulnerable rule reconciliation with a new,
versioned rule identity:

- ref: `cocalc_project_host_direct_tls_v2`
- expression: one zone-wide expression for all reserved `host-*` and
  `direct-check-*` names under the actual Cloudflare zone
- action: `set_config` with `ssl=full`

The v2 identity is intentionally distinct. During a rolling upgrade, an old
staging or production binary can continue changing the legacy v1 rule without
altering v2. New binaries derive the same v2 payload in both deployments,
avoid PATCHing an already exact rule, and read back the complete rule after a
create or repair before permitting direct-route cutover.

Correlated-failure containment and direct-route tunnel-repair guards are in
separate commits. They reduce recovery amplification but are defense in depth,
not the root-cause fix.

## Deployment Gate

No code from this investigation has been deployed.

Before another production direct-ingress cutover:

1. Deploy the v2 reconciliation code to staging and production control planes.
2. Reconcile and read back v2 before changing any production host DNS.
3. Confirm both staging and production hostnames match v2 and negotiate
   WebSockets through Cloudflare.
4. Move one production canary host, observe it, then pace the remaining fleet.
5. Keep the tunnel metadata and rollback path until the direct fleet has
   completed its soak.

The project I/O containment series begins after pre-I/O commit `0f0e68021d`.
It is not fully inert behind one feature flag and must be reviewed separately;
it is not required for this SSL-rule correction.
