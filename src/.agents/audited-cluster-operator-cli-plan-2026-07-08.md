# Audited Cluster Operator CLI Plan

Status: proposed implementation plan.

Date: 2026-07-08.

## Motivation

Recent production incidents exposed the same operational gap several times:

- A project host was running at the cloud provider but not reporting to the hub.
- A host-local repair LRO failed because SSH timed out during banner exchange.
- Project-host memory pressure, backup freshness, legacy restore progress, and
  rollout state required a mix of database queries, SSH, journalctl, and ad hoc
  shell commands.
- Hub and database load had to be diagnosed quickly, but the safe, audited
  operator path was incomplete.

The new `cocalc admin db` work moves database investigation into an audited,
bay-aware command path. The next step is to do the same for host and bay
operations that currently require SSH.

The model should be closer to Kubernetes:

- `kubectl describe` for an object-level summary.
- `kubectl logs` for bounded component logs.
- `kubectl events` for timeline reconstruction.
- `kubectl top` for resource pressure.
- typed control operations instead of arbitrary shell.

The goal is not to turn CoCalc project hosts into Kubernetes nodes. The goal is
to make routine production operations visible, audited, reproducible, and
operator-safe without opening SSH except for break-glass emergencies.

## Goals

- Add audited read-only operator commands for host, bay, LRO, alert, and
  migration incident response.
- Prefer typed, bounded RPCs over arbitrary shell execution.
- Route every operation through the authoritative bay.
- Reuse the existing CLI fresh-auth, audit, LRO, and inter-bay routing patterns.
- Keep project data-plane traffic direct between users and project hosts; do
  not proxy user file/Jupyter/terminal traffic through the hub.
- Make commands usable by humans and Codex agents during incidents.
- Make output structured enough for automated health checks and compact enough
  for terminal use.
- Keep SSH as a documented break-glass fallback, not the normal workflow.

## Non-Goals

- This does not add a generic remote shell over RPC.
- This does not replace cloud-provider APIs or the existing deployment tooling.
- This does not initially expose arbitrary host file reads.
- This does not make destructive operations routine. Mutations remain typed,
  fresh-auth protected, audited, and preferably LRO-backed.
- This does not require a new observability stack before shipping useful CLI
  commands.

## Design Principles

### Read-Only First

Most incident response needs facts before actions. The first implementation
should maximize read-only visibility:

- host state
- host-local logs
- host-local SQLite summaries
- hub/bay state
- database activity
- recent LROs
- recent alerts
- availability timelines
- resource pressure

### Typed Operations, Not Shell

Each operator operation should answer a narrow question:

- "Show logs for `project-host` between two timestamps."
- "Show host-local projects grouped by state."
- "Show current cloudflared and conat connection health."
- "Restart `cloudflared` on this host."

It should not expose:

- arbitrary command execution
- arbitrary file reads
- unbounded journal dumps
- unbounded process lists
- unredacted environment variables

### Bay-Aware by Default

All commands must resolve the authoritative bay:

- host operations route by `project_hosts.bay_id`
- project operations route by `projects.owning_bay_id`
- account-scoped operations route by `accounts.home_bay_id`

If a command receives an id that belongs to another bay, the local bay should
forward to the authoritative bay via the existing inter-bay routing layer.

### Audit Everything

Every operator command should create an audit record with:

- account id
- actor auth session / fresh-auth status
- command name and version
- target object ids
- bay id
- reason, when required
- requested time window and filters
- server-side duration
- row count / byte count
- success or failure
- error class
- redaction mode

Raw outputs can be truncated, but the audit record should preserve enough
metadata to reconstruct what was requested and whether it succeeded.

### Bounded by Construction

Commands should enforce server-side limits:

- max time window
- max rows
- max bytes
- max log lines
- max concurrent host targets
- statement timeout
- RPC timeout
- lock timeout where relevant

The CLI can expose overrides, but production defaults should be safe.

## Command Surface

### Host Commands

#### `cocalc admin host describe <host-id-or-name>`

Purpose: answer "what is this host doing right now?"

Data sources:

- `project_hosts` row
- provider runtime metadata
- latest heartbeat metrics
- bootstrap lifecycle
- software inventory
- observed components
- rollout state
- recent availability events
- recent host-scoped LROs
- pressure state
- assigned/running project counts
- cloudflared metadata
- conat/router status if available

Output should include:

- host identity: id, name, bay, region, owner, pricing model
- provider: status, public/private IP, instance id, zone
- heartbeat: `last_seen`, age, host session id, boot id
- software: current/desired versions, drift, rollout phase
- pressure: zone, reason, candidate counts, recent pressure actions
- capacity: CPU, RAM, disk, btrfs, project counts
- control components: project-host, host-agent, conat-router, conat-persist,
  acp-worker, cloudflared
- recent incidents: stale heartbeat, failed reconcile, OOM, reboot, rollback

Kubernetes analogy: `kubectl describe node`.

#### `cocalc admin host logs <host-id> --component <name> --since 30m`

Purpose: replace routine SSH plus `journalctl`.

Supported components:

- `project-host`
- `host-agent`
- `conat-router`
- `conat-persist`
- `acp-worker`
- `cloudflared`
- `sshd`
- `kernel`
- `bootstrap`
- `reconcile`
- `pressure`
- `podman`
- `btrfs`

Required constraints:

- read-only
- fresh auth optional for ordinary admins, required for sensitive components
  such as `sshd`
- time window capped by default, e.g. 2 hours
- line cap, e.g. 2,000 lines
- byte cap, e.g. 2 MiB
- redact secrets, bearer tokens, project secrets, cloudflare tunnel tokens, SSH
  private material
- include host local monotonic time if available

Implementation options:

- Prefer a host-agent RPC so logs still work if `project-host` is unhealthy.
- Fallback to project-host RPC only if host-agent RPC is not deployed.
- Use `journalctl --output=short-iso` internally, but do not expose arbitrary
  journalctl arguments.
- Include a `--grep` filter implemented server-side with a safe regex/time cap.

Kubernetes analogy: `kubectl logs`.

#### `cocalc admin host events <host-id> --since 24h`

Purpose: produce a single incident timeline.

Merge these sources:

- `project_host_availability_events`
- host-scoped LROs
- project-host software upgrades
- host reconcile/restore events
- pressure actions
- alerts and alert suppressions
- provider status changes
- host heartbeats/registers
- backup/migration activity involving the host

Output should be sorted by timestamp and classify events:

- `online`
- `stale`
- `provider_transition`
- `repair_started`
- `repair_failed`
- `repair_succeeded`
- `upgrade_started`
- `upgrade_succeeded`
- `pressure`
- `alert`
- `operator_action`

Kubernetes analogy: `kubectl events`.

#### `cocalc admin host top <host-id>`

Purpose: answer "what is using resources?"

Data should include:

- host CPU, load, RAM, disk, btrfs, socket counts, fd counts
- per-project top-N by RSS, CPU, file descriptors, sockets, threads, pids,
  inotify instances, disk usage where available
- pressure-controller candidates and reasons
- whether the sampler is fresh, stale, partial, or truncated

This should reuse and expand the existing project-host resource sampler.

Kubernetes analogy: `kubectl top node/pod`.

#### `cocalc admin host ps <host-id>`

Purpose: show process-level evidence without arbitrary shell.

Output should be redacted and summarized:

- project-host daemons
- cloudflared
- sshd
- podman/crun/pasta
- top processes by CPU/RSS
- process age
- command basename and safe arguments only
- project id when mappable

Do not include full environment variables or unbounded command lines.

#### `cocalc admin host net <host-id>`

Purpose: answer "is the host reachable and connected?"

Data should include:

- listening ports for expected services
- cloudflared tunnel health
- conat-router listener and connection counts
- established bay-to-host connections
- SSH listener state
- TCP connection summary by state
- recent network errors from logs

Do not expose arbitrary `ss` output by default; return normalized summaries.

#### `cocalc admin host sqlite ...`

The first version exists as:

```sh
cocalc admin db host-query --host-id ... --sql ...
```

Keep that command, but add curated host diagnostics so operators rarely write
SQLite manually:

- `project-summary`
- `provisioning`
- `ports`
- `stop-state`
- `storage-reservations`
- `quota-queue`

#### `cocalc admin host filesystem <host-id>`

Purpose: diagnose btrfs/disk incidents without SSH.

Data should include:

- mounted filesystems
- data disk size and provider disk size
- btrfs data/metadata/system usage
- qgroup status
- largest project disks, if already sampled
- snapshot counts by project
- auto-grow state
- recent btrfs errors from logs

#### `cocalc admin host podman <host-id>`

Purpose: diagnose rootless runtime stuck states.

Data should include:

- `podman info` health result
- rootless runtime directory
- pause process/user namespace state
- stale runtime-state detection
- running containers count
- recent crun/pasta errors
- safe cleanup recommendation, not automatic cleanup in read-only mode

## Bay Commands

### `cocalc admin bay describe [--bay ...]`

Purpose: answer "is this bay healthy?"

Data sources:

- deployed versions
- hub uptime and process metadata
- worker counts
- DB connection pool status
- `pg_stat_activity` summary
- LRO queue summary
- conat health
- host heartbeat summary
- alerts summary
- backup/migration queue summary

Kubernetes analogy: `kubectl cluster-info`, `kubectl get nodes`.

### `cocalc admin bay logs --component <name> --since 30m`

Supported components:

- `hub`
- `next`
- `lro-worker`
- `backup-worker`
- `migration-worker`
- `conat`
- `notifications`
- `admin-alerts`

Use the same bounded/redacted log rules as host logs.

### `cocalc admin bay events --since 24h`

Purpose: site-wide incident timeline.

Merge:

- admin alerts
- LRO failures
- host availability changes
- DB statement timeout spikes
- deployment events
- backup/migration failures
- conat disconnect spikes
- pressure actions

### `cocalc admin bay db ...`

This should mostly delegate to `cocalc admin db`:

- `activity`
- `locks`
- `table-sizes`
- `slow-queries`
- `statement-timeouts`
- `pool`

Missing diagnostics to add:

- slow query history, if available
- count of statement timeouts by function/API
- active query age histogram
- DB pool saturation history

### `cocalc admin bay conat`

Purpose: inspect control-plane messaging health.

Data should include:

- connected hosts
- connected bays
- subject/service counts
- RPC timeout/error rates
- stale subscriptions
- publish lag or backlog, if measurable
- persist health
- router cluster node health

### `cocalc admin bay alerts`

Purpose: inspect what the alert system is doing.

Data should include:

- recent alerts
- suppressed alerts
- dedupe keys
- unresolved alerts
- automatic remediation attempts
- remediation status
- next retry eligibility

This would have made "running host not reporting" easier to explain:

- one alert
- one deduped repair LRO
- failed due to SSH timeout
- no second repair due suppression window
- later recovered by heartbeat

## Typed Mutating Operations

Mutating operations should not be mixed into read-only commands. They should be
explicit, fresh-auth protected, reason-required, and usually LRO-backed.

### Host Mutations

Candidate commands:

```sh
cocalc admin host reconcile <host-id> --reason ...
cocalc admin host restart-service <host-id> --component cloudflared --reason ...
cocalc admin host restart-service <host-id> --component project-host --reason ...
cocalc admin host pressure-action <host-id> --dry-run
cocalc admin host pressure-action <host-id> --execute --reason ...
cocalc admin host podman-refresh <host-id> --dry-run
cocalc admin host podman-refresh <host-id> --execute --reason ...
```

Rules:

- no arbitrary shell
- dry-run wherever possible
- LRO for operations longer than a few seconds
- automatic rollback/health verification for service restarts where possible
- per-host suppression/debounce to avoid repair storms
- include operator reason in LRO input and audit record

### Bay Mutations

Candidate commands:

```sh
cocalc admin lro retry <op-id> --reason ...
cocalc admin lro cancel <op-id> --reason ...
cocalc admin alert ack <alert-id> --reason ...
cocalc admin alert silence <dedupe-key> --expires 30m --reason ...
```

Use exact target ids, not broad pattern mutation by default.

## API Architecture

### CLI

Add command groups under `src/packages/cli/src/bin/commands/admin`:

- `host.ts`
- `bay.ts`
- `alerts.ts`
- possibly `lro.ts` if LRO operations move out of `admin db`

Use the same CLI context and profile machinery as `admin db`.

### Hub API

Add Conat hub API groups:

- `adminHost`
- `adminBay`
- `adminAlerts`

These APIs should:

- check admin/operator permission
- enforce fresh auth for sensitive or mutating commands
- resolve target bay ownership
- forward cross-bay requests
- create audit records
- apply result caps
- return structured JSON

### Host API

Add a host-scoped admin RPC, preferably served by the stable host-agent:

- `describe`
- `logs`
- `top`
- `ps`
- `net`
- `filesystem`
- `podman`
- `sqliteDiagnostic`

The host-agent is the right long-term home because it is intended to survive
and repair `project-host` daemon failures. If host-agent does not yet have the
RPC plumbing, a project-host implementation can be the first step, but the plan
should explicitly migrate safety-critical diagnostics to host-agent.

### Audit Storage

Reuse the admin DB audit model where possible. If it is DB-specific today,
generalize it to an `admin_operator_audit_log` shape:

- `audit_id`
- `account_id`
- `bay_id`
- `target_type`
- `target_id`
- `command`
- `mode`
- `reason`
- `request`
- `result_summary`
- `started_at`
- `finished_at`
- `duration_ms`
- `success`
- `error_code`
- `error_message`
- `result_bytes`
- `truncated`

Avoid storing huge log payloads in audit records. Store request metadata and
result summaries; log payloads can remain ephemeral response data.

## Safety and Redaction

All log and process outputs should pass through a redaction layer.

Redact:

- bearer tokens
- API keys
- project secrets
- Cloudflare tunnel tokens/secrets
- SSH private key material
- cookies
- authorization headers
- database passwords
- signed URLs where practical

Do not redact:

- host ids
- project ids
- account ids when operator explicitly targets an incident
- timestamps
- component names
- error classes

For commands that may expose user file paths or project process command lines,
mark the command as sensitive and require fresh auth plus a reason.

## Implementation Phases

### Phase 0: Shared Operator Audit and Output Helpers

Deliverables:

- Generalize admin DB audit helper or add a sibling helper for non-DB operator
  commands.
- Add shared result caps and redaction helpers.
- Add shared CLI table/JSON output helpers for operator diagnostics.
- Document the audit contract.

Validation:

- unit tests for audit records
- redaction tests with representative secrets
- CLI output tests

### Phase 1: Host Read-Only Core

Deliverables:

- `cocalc admin host describe`
- `cocalc admin host logs`
- `cocalc admin host events`
- host-side bounded log reader for selected components
- host-side component status snapshot
- hub routing and audit

Why first:

- This directly replaces the SSH/journalctl workflow used during the
  montreal-1 and us-south-1 incidents.

Validation:

- local unit tests for log filtering/redaction
- project-host or host-agent API tests
- CLI tests
- staging smoke test against one host

### Phase 2: Host Resource Diagnostics

Deliverables:

- `cocalc admin host top`
- `cocalc admin host ps`
- `cocalc admin host net`
- `cocalc admin host filesystem`
- `cocalc admin host podman`
- curated host SQLite diagnostics

Why second:

- This covers memory pressure, rootless podman runtime state, cloudflared,
  SSH/network reachability, and btrfs capacity incidents.

Validation:

- sampler freshness/truncation tests
- redacted process-output tests
- host SQLite diagnostic tests

### Phase 3: Bay Read-Only Core

Deliverables:

- `cocalc admin bay describe`
- `cocalc admin bay logs`
- `cocalc admin bay events`
- `cocalc admin bay conat`
- `cocalc admin bay alerts`
- extra DB diagnostics for slow queries and statement timeouts

Why third:

- This addresses global outage/control-plane questions without SSHing into bay
  VMs.

Validation:

- query timeout tests
- LRO/alert timeline tests
- staging control-plane smoke tests

### Phase 4: Typed Repair Actions

Deliverables:

- `admin host reconcile`
- `admin host restart-service`
- `admin host pressure-action`
- `admin host podman-refresh`
- `admin lro retry/cancel`
- `admin alert ack/silence`

Why after read-only:

- Operators need reliable visibility before adding more ways to mutate the
  cluster.

Validation:

- dry-run tests
- fresh-auth enforcement tests
- audit tests
- LRO progress/result tests
- canary staging operations

### Phase 5: UI Integration

Deliverables:

- Admin host page buttons/links for describe, logs, events, top.
- Admin alert page with remediation status and direct LRO links.
- Copyable CLI commands for every UI diagnostic.
- Optional browser-side log viewer with same backend APIs.

Keep the CLI as the canonical implementation first; the UI should reuse the
same APIs.

## Near-Term Recommended Slice

The smallest high-value implementation is:

```sh
cocalc admin host describe <host>
cocalc admin host logs <host> --component project-host --since 30m
cocalc admin host logs <host> --component host-agent --since 30m
cocalc admin host logs <host> --component kernel --since 2h --grep "oom|hung|blocked"
cocalc admin host events <host> --since 24h
cocalc admin bay alerts --since 24h
```

This would have materially improved the recent incident workflow:

- montreal-1 stale heartbeat alert
- us-south-1 reboot/rootless podman recovery
- project-host memory pressure/OOM
- host online/offline false positives
- legacy migration/restore stuck investigations

## Open Questions

- Should ordinary read-only host logs require fresh auth, or only sensitive
  components and grep patterns?
- Should host log access be served by host-agent immediately, or should we ship
  a project-host implementation first and migrate later?
- How much process command-line data is acceptable to expose by default?
- Should failed automatic remediations suppress future attempts for the full
  suppression window, or should they trigger a different fallback remediation?
- Should alert remediation summaries link directly to LRO audit records?
- Should the CLI support `--follow` for logs, or keep the first version
  snapshot-only?

## Success Criteria

- During an incident, an operator can answer "what happened to this host?" with
  `describe`, `events`, and bounded `logs`, without SSH.
- All routine production diagnostics leave an audit trail.
- Commands work cross-bay by id without assuming the local bay is authoritative.
- A Codex agent can run read-only diagnostics safely with explicit reasons.
- Break-glass SSH remains available but is no longer the normal workflow.

