# CoCalc.ai Reliability Failure-Mode Audit

- **Date:** 2026-07-15
- **Scope:** `cocalc.ai` public edge, bay control plane, Postgres, project-host
  fleet, project runtimes, software deployment, monitoring, alerting, and
  disaster recovery.
- **Purpose:** identify the remaining ways the service can fail without prompt,
  accurate detection or bounded recovery, then rank mitigations by reliability
  value versus implementation difficulty.

This is a decision document, not a statement that the listed mitigations have
already been implemented. It complements
`src/.agents/production-cluster-health-checklist.md`, which is the current
read-only operator runbook.

## Executive Summary

The project data plane is substantially safer than it was before the July 2026
hardening work. A project can exhaust its memory without taking down its host;
project-host can reconcile dead containers and stale project daemons; Spot VM
interruptions have bounded recovery and pricing-aware fallback; software is
distributed as immutable artifacts; and hub workers have a health watchdog
with pre-restart diagnostics.

The largest remaining risk has moved upward into the shared control plane and
its observation path:

1. Most detection, remediation, and admin-alert delivery still depends on the
   same bay, hub, Postgres, network, and Cloudflare path being monitored. A bay
   VM, Postgres, router, or public-route failure can therefore hide itself.
2. The per-host synthetic probe exercises the backend control path, not the
   public browser path. A broken Cloudflare tunnel or CORS/session endpoint can
   leave every browser unable to reach a host while the control-plane probe
   passes.
3. The strongest end-to-end user smoke is operator-invoked rather than
   scheduled. A regression can remain latent until a user or operator happens
   to exercise it.
4. Critical maintenance loops are mostly in-process timers without a uniform,
   durable heartbeat. A loop can stop doing useful work while its process
   remains healthy.
5. Bay core services other than hub workers lack active, recurring
   alive-but-wedged detection and bounded repair.
6. Restore and PITR verification exist in code, but production health reports
   that they have not been run on a recurring schedule.

The highest-value next project is a small independent sentinel, but it should
not begin as an autonomous general-purpose repair agent. The safe first
version observes the public service from outside its failure domain, checks
provider state, sends an immediate external page, and performs only a tiny set
of fenced, idempotent repairs. In parallel, several lower-risk in-process gaps
can be closed quickly: public host-route probes, scheduled user smokes, honest
health summaries, maintenance heartbeats, and bay resource checks.

## Ranking Method

Value and difficulty are intentionally coarse:

- **Value 4:** prevents or sharply shortens a site-wide or fleet-wide outage.
- **Value 3:** prevents a host, region, or important user path from remaining
  broken or undiagnosed.
- **Value 2:** materially improves diagnosis, operator safety, or user trust.
- **Value 1:** useful polish or defense in depth.
- **Difficulty 1:** localized change with little new operational state.
- **Difficulty 2:** several components or a new durable record, but no major
  architecture change.
- **Difficulty 3:** new privileged service, complex rollout, or substantial
  failure-mode testing.
- **Difficulty 4:** distributed state/failover architecture with fencing and
  data-consistency risk.

Priority is based on value, time-to-risk-reduction, and the chance that the
mitigation itself causes an outage. `P0` means implement next; `P1` means high
value after the first protections are in place; `P2` is worthwhile hardening;
`P3` is strategic and should not block the lower-risk work.

## Current Protections

The audit assumes the following controls are present and should be preserved:

- Project containers have cgroup-v2 memory and PID containment, per-project
  quota reconciliation, `memory.oom.group=0`, and host-level pressure
  protection. A project OOM normally kills the allocating process instead of
  the container or host.
- Project-host reconciliation detects missing containers and stale project
  daemon heartbeats, updates runtime state, and can recover a stale runtime.
  See `src/packages/project-host/reconcile.ts`.
- Browser project recovery uses runtime generation and host session changes to
  rebuild container-backed terminal and Jupyter connections. File listings and
  sync documents remain correctly separated from container lifecycle.
- Project-host runtime synthetic probes, quarantine, bounded automatic
  recovery, and last-known-good rollback are implemented in
  `src/packages/server/hosts/runtime-maintenance.ts` and
  `src/packages/project-host/hub/projects.ts`.
- Spot host recovery distinguishes provider state, retries alternate machine
  types only for site-funded hosts, bounds retries, and returns to the
  preferred type after the fallback window.
- Project-host, project bundle, tools, container runtime, static, and hub
  releases use immutable artifacts and deployment records. Host installation
  is serialized and rejects invalid/empty artifacts.
- Hub workers are supervised by systemd and by `bay-hub-watchdog`, which
  captures diagnostics, drains one unhealthy worker, restarts it, verifies it,
  and removes the drain. The watchdog deliberately refuses to restart workers
  when router health is bad, preventing a restart storm.
- Project-host storage admission, btrfs metadata checks, disk-pressure alerts,
  and auto-grow protect hosts from common storage cliffs.
- Bay backup code supports base backup, restore verification, and PITR
  verification. The residual issue is operational scheduling and evidence, not
  absence of restore logic.

## Prioritized Gap Register

| ID  | Residual failure mode                                                       | Value | Difficulty | Priority | Recommended action                                                                        |
| --- | --------------------------------------------------------------------------- | ----: | ---------: | -------- | ----------------------------------------------------------------------------------------- |
| R1  | Monitoring and alerting fail with the bay they monitor                      |     4 |        2-3 | P0       | Independent sentinel plus external critical paging and dead-man check                     |
| R2  | Public project-host route/tunnel is broken while backend synthetic passes   |     4 |          1 | P0       | Probe public CORS/session and WebSocket paths for every desired-running host              |
| R3  | No continuously scheduled full user-path canary                             |     4 |        1-2 | P0       | Run a dedicated project start/exec/terminal/Jupyter canary every few minutes              |
| R4  | Health API can report project-hosts healthy from registration count alone   |     4 |        1-2 | P0       | Make health status reflect expected, fresh, quarantined, degraded, and public-route state |
| R5  | Critical maintenance timer silently stops inside a healthy process          |     4 |          2 | P0       | Durable maintenance lease/heartbeat registry and stale-task alerts                        |
| R6  | Router, persist, frontdoor, or cloudflared is alive but wedged              |     4 |          2 | P0       | Independent bay-core watchdog with evidence-first bounded repair                          |
| R7  | Bay memory, disk, inode, WAL, or I/O pressure reaches a control-plane cliff |     4 |        1-2 | P0       | Local bay resource watchdog, external metrics, and safe load shedding                     |
| R8  | Repair destroys the evidence needed for root-cause analysis                 |     3 |        1-2 | P0       | Persist restart/preemption diagnostics outside the affected VM                            |
| R9  | Deployment passes artifact checks but breaks existing live projects         |     4 |          2 | P1       | Existing-runtime compatibility canary plus staged promotion and rollback                  |
| R10 | Backups exist but restore/PITR readiness is unknown                         |     4 |          2 | P1       | Scheduled fenced restore drills with measured RPO/RTO                                     |
| R11 | UX SLO sees successful latency but undercounts total failures               |     3 |          2 | P1       | Attempt/success/failure/timeout metrics and no-success alerts per path                    |
| R12 | Admin alerts are delayed, DB-dependent, and lack incident lifecycle         |     3 |          2 | P1       | Severity, incident keys, open/update/resolve state, and immediate external delivery       |
| R13 | A project can monopolize CPU or I/O despite memory/PID safety               |     3 |          2 | P1       | Complete the per-project resource envelope and host contention telemetry                  |
| R14 | Stopped/cold hosts return with stale or incomplete software                 |     3 |        1-2 | P1       | Mandatory convergence gate before placement and a cold-host fleet audit                   |
| R15 | Rootfs/R2/provider degradation is confused with warm-start health           |     3 |          2 | P2       | Dependency-specific health, cache-hit SLOs, and explicit degraded modes                   |
| R16 | Recovery behavior is not continuously regression-tested                     |     3 |          2 | P2       | Scheduled staging fault-injection suite with production-safe assertions                   |
| R17 | No independent public status surface during a site outage                   |     2 |          2 | P2       | Externally hosted status page driven by sentinel incidents                                |
| R18 | Central writable Postgres remains a hard control-plane SPOF                 |     4 |          4 | P3       | Cross-zone standby, rehearsed failover, and strict fencing                                |
| R19 | A single bay remains a site-wide control-plane failure domain               |     4 |          4 | P3       | Make another bay capable of serving public control traffic and fail over deliberately     |
| R20 | Support reports are an unstructured last-resort outage detector             |     2 |        2-3 | P3       | Triage credible outage reports into paging; do not auto-repair from prose                 |

## Detailed Findings

### R1: Independent Sentinel and Paging

**Failure mode.** Most current checks run in a hub worker and read/write
Postgres. `adminAlert` records a CoCalc message through the same database, and
the email-summary path is periodic rather than an immediate independent page.
A dead bay VM, unavailable Postgres, broken router, or lost public Cloudflare
route can prevent detection, remediation, and notification at the same time.

**Recommended first version.** Run one small on-demand GCP VM in a different
region and failure domain from bay-0. It must not use Spot capacity and must not
depend on the CoCalc hub, Postgres, Conat, CoCalc DNS resolution for its own
control, or CoCalc authentication. It should:

1. Fetch public static and API health endpoints through Cloudflare.
2. Run the public host-route checks in R2.
3. Query GCP directly for the desired bay VM state and recent stop/preemption
   events.
4. Send critical alerts through an external channel immediately.
5. Publish a dead-man heartbeat to a service outside the sentinel VM.

**Safe automatic actions.** Begin observe-only. After the signals are proven,
allow only actions with unambiguous preconditions:

- Start a designated bay VM when provider state is `TERMINATED`, CoCalc says it
  should be running, and the condition is observed twice.
- Ask a local, narrowly authenticated bay agent to restart cloudflared when the
  direct origin is healthy but the public route is repeatedly unhealthy.
- Verify recovery after every action and page if it fails.

Do not initially let the sentinel restart Postgres, reboot a running bay VM,
change schemas, move projects, or execute arbitrary SSH commands. Give its
service account `get` and `start` permission only on explicitly labelled VMs;
add one narrowly scoped repair operation at a time. Every action needs an
incident ID, cooldown, maximum attempt count, and append-only audit record.

**Split-brain protection.** The sentinel and in-bay recovery loops can observe
the same event. Repairs must therefore be idempotent and fenced. Provider
operations should use current instance generation/state, while in-bay actions
should use an expiring repair claim. If Postgres is unavailable, the sentinel
must restrict itself to provider-state operations that remain safe without a
database lock.

**Acceptance criteria.** Stopping the staging bay VM, killing its public
tunnel, and wedging a hub route should each produce a correctly classified
external incident. The sentinel should neither restart a healthy service nor
perform more than the configured maximum number of repair attempts.

### R2: Public Browser-to-Host Probes

**Failure mode.** `runSyntheticRuntimeProbe()` in
`src/packages/project-host/hub/projects.ts` starts a synthetic project and
checks sandbox exec/file behavior through the backend control path. It does
not traverse the public hostname, Cloudflare tunnel, CORS preflight,
`/.cocalc/project-host/session`, or the browser WebSocket route. Consequently,
the backend synthetic can pass while browsers receive CORS or route errors.
This exact class of failure has already occurred.

**Point-in-time evidence.** On 2026-07-15, a read-only audit sent an `OPTIONS`
request with `Origin: https://cocalc.ai` to the project-host session endpoint
for all 15 desired-running production hosts. All 15 returned HTTP 204 with the
expected `Access-Control-Allow-Origin`. This proves the check is cheap and
useful; it does not make it continuous.

**Recommended probe layers.** Keep the existing backend synthetic and add
separately attributed public checks:

1. DNS resolves the expected host name.
2. TLS and HTTP reach Cloudflare and the tunnel origin.
3. CORS preflight for `POST /.cocalc/project-host/session` returns the expected
   origin and headers.
4. An unauthenticated or deliberately invalid session request returns the
   expected bounded authorization response with CORS headers, not a generic
   Cloudflare 5xx.
5. A dedicated canary credential periodically completes authenticated session
   bootstrap and opens the public WebSocket/data path.

Probe every desired-running shared host every 60-120 seconds with jitter. Do
not page on intentionally stopped private hosts. Two consecutive failures
should quarantine placement and open an incident; a direct-origin success plus
public-route failure should classify the tunnel/edge rather than the project
runtime. Recovery requires two successes to avoid flapping.

**Implementation status (2026-07-15).** R2 now continuously checks public
health, CORS preflight, and the bounded unauthenticated session response for
fresh desired-running hosts. Probe state is persisted per host, placement is
quarantined after two failures, recovery requires two successes, and operator
alerts are aggregated across hosts. Public-route failures are classified
separately and never trigger automatic VM or runtime reboot. The dedicated
authenticated session and WebSocket/data-path canary remains part of R3.

### R3: Scheduled Full User-Path Canary

**Failure mode.** `admin smoke` and the cloud smoke runner can exercise a rich
project lifecycle, but the strongest production canary is currently invoked
by an operator. `launch_smoke_results` records results and health warns when a
result is stale, but warning about a missing smoke is not equivalent to running
one. During the July rollout, the previous production smoke was about two days
old until one was run manually.

**Recommended canaries.** Schedule a lightweight canary every five minutes,
from the independent sentinel when feasible. Use a dedicated account and
projects so user data and billing are not involved. Attribute these paths
separately:

- Public static page and authenticated API.
- Existing warm project start with verified rootfs cache hit.
- Project exec through the public project-host session path.
- Persistent terminal creation and a command/response marker.
- Jupyter kernel start and a trivial execution marker.
- File listing/file-server operation.
- Syncdoc open/change acknowledgement through conat-persist.

Terminal and Jupyter are container-backed; listings and syncdocs are not. A
single composite "project failed" result would erase that distinction and make
diagnosis worse. Store individual step timing and failure class, plus one
overall outcome.

Rotate the canary among shared regions/hosts while the existing host-local
synthetic covers every host. Page after two consecutive global canary failures,
but quarantine a single host after repeated host-specific failures. Rootfs
cache misses and restore/dearchive starts must be labelled and excluded from
the warm-start SLA rather than discarded.

### R4: Honest Machine-Readable Health

**Failure mode.** The project-host section of `getLaunchHealth()` in
`src/packages/server/conat/api/system.ts` can be healthy merely because one or
more hosts are registered. Registration count does not prove that expected
shared hosts are fresh, reachable, accepting placement, or passing synthetic
and public probes. A monitor can therefore receive an HTTP 200 and a "healthy"
summary during a real host-fleet outage.

**Recommended model.** Health must compare desired state with observed state,
not merely count rows. Export at least:

- Expected desired-running shared/site-funded hosts.
- Fresh, stale, offline, restarting, and provider-terminated counts.
- Degraded, quarantined, recovery-exhausted, and admission-denied counts.
- Age/result of backend runtime synthetic and public-route probe.
- Disk and btrfs metadata pressure.
- Unexpected artifact/runtime overrides.
- Expected, healthy, drained, and watchdog-restarting hub workers.
- Router, persist, frontdoor, cloudflared, Postgres, and maintenance-loop
  status.

Return component state (`healthy`, `degraded`, `critical`, `unknown`) plus
reason codes and timestamps. Intentionally off customer hosts must not make the
site critical. Unknown/stale observations must not silently collapse to
healthy. The sentinel should combine this endpoint with its independent public
and provider checks rather than trusting it as the sole authority.

### R5: Durable Maintenance-Loop Liveness

**Failure mode.** Host availability, Spot recovery, runtime synthetic probes,
cloud work, auto-grow, service admission, UX alerts, projections,
notifications, and backup maintenance are primarily in-process timer loops. A
loop can fail to initialize, stop being scheduled, remain behind a stale
singleton/leader decision, or throw on every iteration while the worker still
passes process and route health.

**Recommended registry.** Add one durable maintenance-heartbeat table with:

- Task name and bay.
- Expected interval and maximum tolerated lag.
- Owner worker/session and leader/lock identity.
- `last_started`, `last_finished`, and `last_success`.
- Last error, consecutive failures, and current run/claim ID.
- Optional progress cursor for long jobs.

Each critical loop updates the same contract. `admin health` reports stale or
erroring tasks, and the sentinel reads a compact exported summary. The table
does not replace external DB health: if Postgres itself is down, the sentinel
must classify that independently.

Start with host availability/Spot recovery, host runtime maintenance, the
cloud work queue, backup/WAL maintenance, projections, and notification
outbox. Alert only after task-specific grace periods; a five-minute loop and a
daily backup cannot use the same stale threshold.

### R6: Bay Core Alive-but-Wedged Recovery

**Failure mode.** systemd restarts bay services when their processes exit, but
router, persist, frontdoor, and cloudflared have no recurring active watchdog
equivalent to `bay-hub-watchdog`. Startup health checks do not detect a process
that later remains alive while unable to serve. The hub watchdog correctly
refuses to restart workers when router health is bad, but nothing then performs
a bounded router repair.

**Recommended design.** Add a separate `bay-core-watchdog` systemd timer or
small native supervisor. It must not depend on a hub worker and should avoid
Postgres for local process/readiness checks. On every cycle:

1. Check router, persist, frontdoor, and local cloudflared origin health.
2. Record component-specific latency and reason codes.
3. On repeated failure, capture process tree, sockets, resource state, recent
   journal, and a bounded stack/profile diagnostic.
4. Restart exactly one failed component in dependency order.
5. Verify it and observe a cooldown before considering another restart.

Use systemd `WatchdogSec`/`sd_notify` for services that can report event-loop
progress, not only process existence. Never restart all core services together.
Do not automatically restart Postgres in this phase. A public-only cloudflared
failure should be repaired only when an external probe confirms the public
path is broken and local origin health is good.

### R7: Bay Resource Guard

**Failure mode.** Project hosts now contain user memory, but the bay remains a
shared control-plane VM. Current bay preflight checks resource headroom at
startup/deploy time; bay systemd units do not impose or actively monitor a
complete runtime resource policy. Root disk/inode exhaustion, Postgres WAL
growth, runaway journals/releases, backup I/O, swap thrash, or a hub worker
leak can degrade every user before an application-level alert is delivered.

**Recommended local watchdog.** Every 30-60 seconds record:

- Root and `/mnt/cocalc` bytes and inodes.
- Available memory, swap-in/out, PSI memory/CPU/I/O, load, and iowait.
- Postgres data/WAL growth, connection count, oldest transaction, lock waits,
  and checkpoint pressure.
- Service RSS, file descriptors, task count, and restart count.
- journald, release, temporary build, and backup workspace sizes.

Warn conservatively and page before a hard cliff. Safe automatic actions are
limited to bounded retention already defined for old releases/logs and pausing
nonessential build/backup work under critical pressure. Do not hard-cap
Postgres memory or make every service immune to the OOM killer. Favor
Postgres/router/frontdoor in OOM scoring, then stage-test `MemoryHigh` and a
generous `MemoryMax` for individual hub workers so one leak cannot consume the
VM.

### R8: Durable Incident Evidence

**Failure mode.** The recent hub watchdog adds valuable diagnostics, but a VM
stop, preemption, reset, disk failure, or replacement can make local journal
and process state unavailable. Automatic recovery that runs before evidence is
copied can turn an actionable root cause into "it restarted and now works."

**Recommended evidence path.** Export systemd/journald, kernel OOM/hung-task,
cloudflared, provider lifecycle, serial-console, and watchdog events to storage
outside the affected VM. For each automated repair, write a structured
incident record containing:

- Detection sources and first/last observation.
- Provider VM state and recent GCP operation/audit events.
- Boot ID, service PID/restart count, resource snapshot, sockets, and relevant
  bounded log tail.
- Exact action, claim/fence ID, result, and verification evidence.
- Software artifact versions and active overrides.

Collection must be bounded in time and bytes so a diagnostic cannot itself
exhaust disk or stall recovery. Keep a short searchable index and longer-term
compressed blobs with explicit retention. Use this record for the resolution
message and post-incident review.

### R9: Deployment Compatibility Canary and Rollback

**Failure mode.** `software smoke tools`/host software smoke currently checks a
representative host's artifact/runtime deployment status and a rootfs RPC. It
does not prove that an already-running project can execute a binary from the
new tools mount. The July tools incident showed why that matters: old projects
could retain an empty/broken `/opt/cocalc/bin2`, while restarting the project
fixed it. Artifact validity and fresh-start success are necessary but not
sufficient.

**Recommended promotion gate.** For project-host, tools, project bundle, and
container runtime releases:

1. Select a dedicated already-running canary project and record container PID,
   runtime generation, and mounted artifact versions before deployment.
2. Deploy to one representative staging/production host.
3. In the same existing container, run version/marker checks for required
   tools, including the actual Codex/app-server executable path.
4. Start a fresh canary project and run the same checks.
5. Verify terminal, Jupyter, file listing, and public session bootstrap.
6. Promote in bounded host batches only after the canaries pass.

If the release breaks only existing runtimes, prefer repairing the mount or
rolling back the artifact rather than restarting every user project. A fleet
restart remains the last safe repair when mount state cannot be fixed in place.

For bay/static deploys, retain the previous release, canary one hub worker,
run public and user-path smoke, and roll code back automatically on failure.
Database migrations complicate rollback: require expand/contract,
backward-compatible migrations before automatic code rollback is enabled.

### R10: Restore and PITR Drills

**Failure mode.** Backup success proves that bytes were uploaded; it does not
prove that the current keys, manifests, WAL chain, schema, and operator steps
can restore a working service within the expected time. Production health has
reported both restore-test and PITR-test as not run.

**Recommended schedule.** Run a fenced restore into an isolated workspace or
VM at least daily for the base backup and weekly for PITR. The runner should:

- Use dedicated read-only backup credentials and a separate destination.
- Verify schema/catalog invariants and a small set of application queries.
- For PITR, recover through a uniquely generated marker timestamp and prove
  inclusion/exclusion around that point.
- Destroy the isolated restore after preserving bounded evidence.
- Record achieved RPO/RTO, backup IDs, WAL range, duration, and last success in
  health status.

Do not give the general external sentinel the site master key. Run restore
tests in a dedicated narrowly scoped service and let the sentinel verify only
that a recent signed result exists.

### R11: Attempt- and Failure-Based UX SLOs

**Failure mode.** `src/packages/server/monitoring/ux-latency.ts` has useful P95
metrics and explicit project-start stuck/timeout events. It does not yet
consistently represent attempts, failures, and timeouts for terminal, Jupyter,
exec, file-server, and syncdoc paths. If every attempt fails before a success
latency event is emitted, the P95 can be absent or deceptively healthy.

**Recommended event contract.** Every monitored operation emits one attempt
and exactly one terminal outcome: success, expected rejection, failure, or
timeout. Aggregate by operation, bay, host, client version, and relevant
segment. Alert on:

- Error/timeout rate with minimum attempts.
- Attempts with zero successes in a short window.
- P95/P99 among successes.
- A sharp host/region/client-version deviation from fleet baseline.

Expected quota, abuse-policy, user cancellation, restore/dearchive, and rootfs
cache-miss outcomes need explicit reason codes so they do not page as platform
failures. Sample and deduplicate high-volume client events to prevent a single
malicious or reconnecting browser from manufacturing a fleet incident.

### R12: Incident and Alert Lifecycle

**Failure mode.** `adminAlert` is a useful audit/message mechanism, but alerts
are DB-dependent, use message text for deduplication, lack severity and
open/resolved state, and can reach email only on the summary cadence. Operators
can receive repeated symptoms without one coherent incident or a verified
recovery notification.

**Recommended model.** Add:

- Stable incident key, severity, component, affected scope, and reason code.
- `open`, `updated`, `mitigating`, `resolved`, and `exhausted` states.
- First/last seen, observation count, action history, and verification result.
- Immediate external page for critical incidents.
- CoCalc admin message as the durable in-product audit, not the only channel.
- Resolution notification only after consecutive successful probes.

Alert delivery needs its own dead-man test. A daily synthetic critical test in
a nonpaging destination should prove that generation, external delivery, and
acknowledgement still work.

### R13: Complete Project Resource Envelope

**Failure mode.** Memory, swap, PID, file-descriptor, and core limits are now
represented in `src/packages/project-runner/run/limits.ts`. CPU shares provide
fairness but are not a hard CPU ceiling, and storage I/O contention can still
make a host feel unavailable even when memory containment works. A project may
therefore monopolize CPU, I/O queue depth, or another kernel resource without
crashing the VM.

**Recommended next step.** Inventory every resource dimension and explicitly
classify it as hard limit, fair share, admission limit, or monitor-only:

- CPU quota/burst and shares.
- Block I/O weight and, where safe, maximum throughput/IOPS.
- Network egress quota/rate and connection count.
- Btrfs bytes, metadata, inodes, and snapshot amplification.
- PIDs, file descriptors, locked memory, core files, and IPC objects.

Preserve useful burst behavior. Paid CPU/memory should define the normal hard
envelope, while a private site-managed host may intentionally grant more than
the account membership cap. Stage-test parallel CPU burners, fork bombs,
metadata-heavy file creation, and sustained random I/O. Verify that one project
slows or fails without raising host synthetic latency beyond the chosen SLO.

### R14: Cold and Stopped Host Convergence

**Failure mode.** A stopped host cannot receive a live artifact rollout. When
it later starts, stale bootstrap helpers, project-host, container runtime,
tools, or security policy can re-enter the fleet. This is especially dangerous
when a new project-host assumes a matching privileged bootstrap command.

**Recommended gate.** Before a newly connected host accepts placement:

1. Resolve the global/default desired versions without per-host overrides.
2. Reapply current bootstrap/security helpers.
3. Install and validate container runtime, project-host, project bundle, and
   tools in dependency order.
4. Run host-local runtime synthetic and public-route probe.
5. Mark the host placement-eligible only after all required versions and
   capabilities agree.

Fleet health should list stopped hosts as `not observed` with their last known
versions, not silently healthy. Run a periodic metadata audit over all hosts,
including off ones, so the next-start plan is known before an emergency.

### R15: External Dependency Degraded Modes

**Failure mode.** GCP API/quota, Cloudflare, R2/artifact storage, rootfs
registry, email, and other providers can fail independently. A cold rootfs pull
may be cross-region and tens of gigabytes, while a verified cache hit should be
fast. Combining these into one "project start" signal either creates false
pages or hides a warm-start regression.

**Recommended model.** Export dependency-specific state and preserve cached
operation during an outage:

- Rootfs cache hit/miss, source region, bytes, and pull progress.
- Artifact/cache availability and last verified local copy.
- Cloudflare public versus direct-origin result.
- Provider API availability, quota/capacity rejection, and VM state.
- Email/external page delivery status.

Apply the project-start SLA only to verified cache hits. Show a bounded,
specific user message for cache pulls, provider capacity retries, and host
restart recovery. Avoid evicting known-good local artifacts merely because the
remote registry is temporarily unavailable.

### R16: Staging Fault-Injection Regression Suite

**Failure mode.** Recovery code is exercised during real incidents, but many
correctness properties are temporal: retries, fencing, cooldowns, stale state,
multiple browser tabs, and replacement generations. Unit tests cannot prove
that the whole deployed system preserves them.

**Recommended scheduled suite.** In staging, regularly and deliberately:

- Stop and preempt a host VM; test alternate Spot type and on-demand fallback.
- Kill cloudflared while keeping project-host healthy.
- Kill/wedge one hub worker, then router, persist, and frontdoor separately.
- OOM one project at low and high quotas; run CPU, PID, inode, and I/O stress.
- Kill a project container and project daemon independently.
- Break one tools artifact/mount in a canary namespace.
- Pause a critical maintenance loop and expire its leader claim.
- Fill a disposable filesystem to warning/critical thresholds.
- Run restore and PITR drills.

Assert incident classification, maximum repair attempts, no restart storm,
preserved evidence, user-visible state, and recovery time. Never run destructive
fault injection against production; production checks remain read-only except
for the explicitly fenced canary projects and repair actions.

### R17: External Status Surface

**Failure mode.** During a bay/public-route outage, CoCalc cannot reliably use
its own frontend to explain the incident. Users see a frozen or unavailable
site and support receives duplicate reports.

**Recommended action.** Host a minimal status page outside the bay and ideally
outside the primary provider path. The sentinel should open/update/resolve
component incidents automatically, with operator override. Components should
separate web/control plane, project hosts by region, files/syncdocs, project
runtimes, and third-party dependencies. Do not expose host IDs, user/project
identifiers, sensitive diagnostics, or speculative root causes.

### R18: Postgres High Availability

**Failure mode.** The central writable Postgres is still a hard control-plane
single point of failure. Backups limit data loss but do not provide low-RTO
availability. An unhealthy database can also prevent in-bay health state,
repair claims, and alerts.

**Near-term protection.** Before attempting failover, add independent bounded
SQL probes, connection saturation/lock/WAL metrics, external log export, and a
tested manual recovery runbook. Ensure every maintenance loop fails closed or
degrades safely when Postgres is unavailable rather than retrying without
bound.

**Strategic solution.** Maintain a streaming standby in another zone, monitor
replication lag externally, and rehearse manual promotion before considering
automatic failover. Promotion requires strict fencing of the old primary,
authoritative endpoint change, application reconnect validation, and a tested
failback procedure. A fast but ambiguous database failover is worse than a
slower fenced one; keep this P3 until R1-R12 provide the observability needed to
operate it safely.

### R19: Bay-Level Failover

**Failure mode.** Even with worker redundancy, the primary bay remains a
correlated failure domain for router, persist, frontdoor, cloudflared,
Postgres, and operational loops. A regional/provider/network failure can exceed
what local process supervision can repair.

**Strategic solution.** Continue the multibay architecture so a second bay can
serve public control traffic with explicit ownership routing. Separate
stateless public ingress failover from authoritative database failover. First
prove read-only/public routing and account/project ownership resolution in a
secondary bay; only then design write authority and database promotion.

This is high value but not "easy Kubernetes." It requires explicit data
authority, fencing, replicated control state, and repeatable drills. The lower
priority number reflects difficulty and blast radius, not lack of importance.

### R20: Support as a Secondary Signal

**Failure mode.** A credible support report may be the first evidence of a
path-specific incident not covered by metrics. Polling support and letting an
agent mutate production from prose would, however, introduce uncertain intent,
prompt-injection risk, false positives, and broad unattended authority.

**Recommended bounded use.** Later, classify incoming support messages for
outage language and attach them to an existing incident or page a human when
multiple independent accounts report the same symptom. Redact content and
never execute instructions from a ticket. An empowered coding agent may assist
after an operator opens a time-bounded incident session with explicit action
limits, but should not be the first-line autonomous watchdog.

## Implementation Sequence

The sequence is designed to improve visibility before adding repair authority.

### Phase 0: Close Cheap Blind Spots

1. Add per-host public CORS/session probes and expose their result in host
   health.
2. Make `admin health` compare desired and observed host/bay state.
3. Schedule the existing admin smoke and retain step-level results.
4. Add bay disk/inode/memory/PSI checks and immediate external critical alert
   delivery.
5. Extend tools/project-host software smoke to an already-running canary
   project.

These are mostly Difficulty 1 changes and provide immediate detection without
new automatic repair.

### Phase 1: Independent Observation and Loop Accountability

1. Deploy the sentinel in observe-only mode with a dead-man monitor.
2. Add the durable maintenance-heartbeat registry.
3. Add the bay-core watchdog in observe-only/diagnostic mode.
4. Export provider, kernel, service, and watchdog evidence externally.
5. Add attempt/failure outcome telemetry to terminal, Jupyter, exec, file, and
   sync paths.

Run this long enough to measure false positives and establish normal latency
before enabling restarts.

### Phase 2: Bounded Repair and Recovery Proof

1. Allow the sentinel to start an unambiguously terminated desired-running bay
   VM.
2. Allow local cloudflared repair on public-fail/direct-origin-pass evidence.
3. Enable one-at-a-time router/persist/frontdoor repair with cooldown and
   diagnostics.
4. Schedule base restore and PITR drills.
5. Add incident lifecycle and external status updates.
6. Run the staging fault-injection suite on a schedule.

### Phase 3: Strategic Redundancy

1. Implement and rehearse a fenced Postgres standby promotion.
2. Establish secondary-bay public/control-plane failover.
3. Consider broader autonomous remediation only after the incident and fencing
   model has demonstrated safety.

## Initial Decision Package

The best first implementation batch is:

1. **R2 public host-route probe.** Highest confidence, low effort, directly
   closes an incident already seen in production.
2. **R4 honest health model.** Prevents external monitoring from trusting a
   false green signal.
3. **R3 scheduled user canary.** Turns the strongest current manual validation
   into continuous evidence.
4. **R5 maintenance heartbeats.** Makes existing recovery code observable and
   detects silent timer/leader failure.
5. **R1 sentinel in observe-only mode.** Removes the shared failure domain
   before granting any repair authority.
6. **R7/R8 bay resource and evidence export.** Prevents avoidable cliffs and
   preserves the cause when recovery is needed.

This package materially lowers overnight risk without attempting automatic
database failover, general SSH repair, or a second control plane.

## Safety Invariants

Every reliability change should preserve these invariants:

- Detection precedes mutation, and evidence is captured before restart.
- A repair is idempotent, fenced, rate-limited, and bounded by attempts/time.
- One failed component is repaired at a time in dependency order.
- A recovery is not declared until an independent user-relevant probe passes.
- Unknown or stale observations never become healthy by default.
- Expected user/quota/abuse errors do not page as infrastructure incidents.
- Intentionally stopped customer hosts do not count as a site outage.
- Private project hosts remain CoCalc-managed infrastructure and receive the
  same security/runtime convergence; "private" only controls project
  placement.
- Customer-funded hosts never change billable machine type automatically;
  pricing-aware alternate-type fallback remains restricted to site-funded
  hosts.
- No autonomous process receives general root, unrestricted SSH, database
  mutation, and provider control at the same time.
- Every monitor has a dead-man check outside its own failure domain.

## Definition of "Sleep-Well" Reliability

The near-term work is successful when all of the following are continuously
true:

- A dead bay VM, broken public edge, dead host tunnel, wedged hub worker, stale
  maintenance loop, and failed user canary are each detected within five
  minutes by a system outside the failing component.
- Critical incidents page immediately through a channel independent of CoCalc
  and later resolve with verified evidence.
- Safe VM/tunnel/worker repairs complete within bounded attempts and cannot
  cause a fleet-wide restart storm.
- A single project exhausting memory, PIDs, CPU, or I/O cannot crash or wedge a
  host.
- Deployment promotion proves both fresh and already-running project behavior.
- Production health cannot be green when expected shared hosts, core bay
  services, critical maintenance tasks, or recent user canaries are unknown or
  failing.
- A recent fenced restore and PITR test proves the documented RPO/RTO.
- Every automated restart leaves enough external evidence to answer what
  failed, why the action was taken, and whether it actually recovered.
