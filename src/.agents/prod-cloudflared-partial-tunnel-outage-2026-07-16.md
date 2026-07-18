# Production project-host tunnel outage: 2026-07-16

## Summary

Projects on `us-south-1` (`7bd699f8-e20b-4b13-9dfa-f7358f85544e`) became
intermittently inaccessible from browsers. Project files could sometimes still
be read or saved, but routed Conat WebSockets and terminal initialization failed.
Restarting `cocalc-cloudflared.service` restored service.

This was a partial tunnel failure, not a project-runtime, VM, database, or hub
failure. The host heartbeat and project-host RPC path remained healthy, and
systemd continued to report cloudflared as active.

## Impact

- Browser connections routed to the affected project host intermittently failed.
- Terminals and other project services that require a host WebSocket could not
  initialize.
- The host briefly appeared offline to users even though its backend heartbeat
  and project runtimes were healthy.
- Other currently running production hosts were not affected. After recovery,
  all 11 fresh/running hosts passed HTTP, CORS, session, and eight sampled
  WebSocket upgrade probes.

## Evidence

- Browsers repeatedly failed to upgrade
  `wss://host-7bd699f8-...cocalc.ai/conat/?EIO=4&transport=websocket`.
- The downstream `file server not initialized` error was a consequence of the
  missing host connection, not a separate file-server failure.
- Host-to-hub control RPCs, project status, host heartbeat, and project runtimes
  remained responsive.
- `cocalc-cloudflared.service` and its process remained active, so
  `Restart=always` did not fire.
- One cloudflared connector repeatedly logged `control stream encountered a
  failure while serving`; the failed process accumulated roughly 129 such
  failures in two hours.
- A manual cloudflared service restart registered four healthy connectors and
  immediately restored browser access.

## Root cause

The proximate root cause was a cloudflared process with a persistently unhealthy
connector/control stream that did not recover or terminate the parent process.
Cloudflare continued routing some browser requests through the impaired tunnel
set, causing intermittent WebSocket failures while simple HTTP checks and
backend host health remained good.

The underlying reason that cloudflared's connector entered this persistent
failure mode is not established from host logs. It may be an upstream transport
or cloudflared defect. The operational defect in CoCalc was clear: monitoring
tested HTTP health, CORS, and session rejection but not an actual WebSocket
upgrade, and systemd could only restart cloudflared after a process exit. A live
but partially broken process could therefore remain indefinitely.

## Remediation

The review-only change set adds:

1. Eight real unauthenticated Engine.IO WebSocket upgrade samples to every
   project-host public-route probe. The handshake validates HTTP 101 and
   `Sec-WebSocket-Accept`.
2. The existing two-consecutive-failure quarantine threshold before any repair.
   A single transient failure does not restart anything.
3. A narrowly typed host RPC that can only run
   `sudo -n /usr/local/sbin/cocalc-cloudflared-ctl restart`. It accepts no shell
   command or arbitrary service name.
4. Capability advertisement in host heartbeat metadata. Central code will not
   call old or unsupported hosts during a rolling deployment.
5. An atomic database claim, a 30-minute per-host cooldown, and a five-minute
   fleet spacing gate. At most one tunnel is restarted per bay during the fleet
   spacing window.
6. Persistent claim, trigger, result, and error metadata under
   `public_route_auto_recovery`, plus central and host logs and admin alerts.
7. Continued quarantine until two subsequent public-route probes pass. Tunnel
   repair never reboots a VM or project runtime.
8. A `TimeoutStopSec=30` systemd drop-in. Bootstrap applies this with
   `daemon-reload` and does not restart an otherwise unchanged healthy tunnel.

This does not guarantee that a tunnel can never fail. It makes this observed
failure mode directly detectable and provides bounded automatic recovery instead
of allowing a live-but-broken process to persist until an operator intervenes.

## 2026-07-18 diagnostic and configuration hardening

Subsequent incidents on multiple production hosts showed that automatic repair
worked, but the original implementation did not retain enough evidence to
distinguish a connector defect, a QUIC transport problem, a Cloudflare edge
event, or a false probe failure. The following staging change set addresses
that gap without widening the repair authority:

1. Every WebSocket attempt records success, duration, HTTP status, error, and
   `CF-Ray`. Failed HTTP, CORS, and session stages retain their completed stage
   results instead of replacing all probe evidence with one error string.
2. The aggregate WebSocket probe filters successful settled promises correctly.
   Previously, a tolerated failure in the first array position could pass the
   75% threshold and then throw while reading the first result as a success.
3. Before a tunnel restart, project-host captures the exact cloudflared version,
   process ID/state/age, `/ready`, `/diag/tunnel`, a strict allowlist of
   Prometheus connection/RPC/QUIC metrics, and a short redacted journal tail.
   `/diag/configuration` is never read because it may contain credentials.
4. The same bounded snapshot is captured after restart, once at least one edge
   connection is ready or a five-second post-restart observation bound expires.
5. Heartbeats expose a compact readiness/version/protocol/edge summary. They do
   not include journal text or full metrics.
6. Each monitor pass records how many hosts were checked, which hosts failed,
   and grouped failure classes. Two or more failures in one pass are explicitly
   marked as correlated, but the existing fleet restart spacing remains the
   mutation safety boundary.
7. The latest repair remains under `public_route_auto_recovery`; the six newest
   completed or failed repair records are retained under
   `public_route_incidents`, newest first.
8. The privileged journal wrapper now has separate bounded `snapshot` and
   interactive `follow` modes. This fixes empty admin log retrieval without
   granting arbitrary `journalctl` access.
9. New hosts install cloudflared `2026.7.2` from a versioned release URL and
   verify an architecture-specific SHA-256 digest before `dpkg`. Existing hosts
   report version drift but are not silently upgraded during reconciliation.
   The managed unit also passes `--no-autoupdate` explicitly.
10. Tunnel transport is explicit and defaults to Cloudflare's recommended
    `auto`. Operators may set host metadata `cloudflared_protocol` to `quic` or
    `http2` for a controlled comparison. `cloudflared_grace_period_seconds`
    defaults to 10 and is clamped to 1..30 seconds. The systemd stop timeout
    remains 30 seconds, leaving time for application grace before forced stop.

The diagnostics collector probes only loopback ports 20241 through 20245, which
are cloudflared's documented automatic metrics listener range. Collection is
best effort and cannot prevent or authorize a restart. Heartbeat collection is
cached for 60 seconds to avoid turning observability into host load.

## Configuration

- `COCALC_HOST_PUBLIC_ROUTE_PROBE_WEBSOCKET_ATTEMPTS` defaults to `8` and is
  clamped to `4..16`.
- `COCALC_HOST_PUBLIC_ROUTE_AUTO_REPAIR_ENABLED` defaults to enabled. Set it to
  `false` for detection/quarantine/alerting without repair.
- `COCALC_HOST_PUBLIC_ROUTE_AUTO_REPAIR_HOST_COOLDOWN_MS` defaults to 30 minutes.
- `COCALC_HOST_PUBLIC_ROUTE_AUTO_REPAIR_FLEET_SPACING_MS` defaults to 5 minutes.
- `COCALC_HOST_PUBLIC_ROUTE_AUTO_REPAIR_RPC_TIMEOUT_MS` defaults to 75 seconds.

### Repair claim crash window

The repair claim expires after two minutes, but an expired claim does not bypass
the 30-minute per-host cooldown. This is deliberate. If a bay worker exits after
asking the host to restart cloudflared but before persisting the RPC result, the
database cannot distinguish an unexecuted request from a completed restart with
a lost response. Waiting for the host cooldown avoids repeatedly interrupting a
healthy replacement tunnel.

During this uncertainty window the host remains quarantined and the persisted
`public_route_auto_recovery` metadata retains the claim, trigger, and timestamps
for operators. A later monitor pass may claim another repair after the cooldown,
subject to the bay-wide spacing gate. The database-backed maintenance test locks
in this behavior, including cooldown expiry and fleet spacing.

## Deployment plan

Do not deploy this change set before operator review.

1. Deploy/reconcile bootstrap. The new timeout drop-in causes a daemon reload but
   does not restart an unchanged cloudflared service.
2. Roll out project-host software and confirm fresh heartbeats contain
   `cloudflared_restart_supported=true`.
3. Deploy the bay/server monitor. Optionally begin with
   `COCALC_HOST_PUBLIC_ROUTE_AUTO_REPAIR_ENABLED=false` to observe the new
   WebSocket signal before enabling repair.
4. Confirm `public_route_probe.result.websocket_attempts=8` on healthy hosts.
5. Exercise a canary by stopping or isolating its tunnel only during an approved
   maintenance window; verify quarantine, one claimed restart, and recovery
   after two successful probes.

For the 2026-07-18 change set, deploy host bootstrap before project-host so the
new snapshot-mode journal wrapper is present first. Refresh static as part of
the exact source revision, then deploy hub last. On staging, leave one host on
`auto` and set one host to `http2`; compare readiness, connector churn, probe
latency/failures, and actual project WebSocket behavior before choosing any
production transport override. Do not infer a transport winner from one manual
restart alone.

## Rollback

Disable repair immediately with
`COCALC_HOST_PUBLIC_ROUTE_AUTO_REPAIR_ENABLED=false`. The enhanced probe and
quarantine remain useful without mutation. Rolling back server code removes the
new monitor behavior; the host RPC and systemd timeout drop-in are inert unless
called.
