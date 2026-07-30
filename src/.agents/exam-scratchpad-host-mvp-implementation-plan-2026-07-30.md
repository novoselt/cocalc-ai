# Exam Scratchpad Host MVP Implementation Plan

Date: 2026-07-30

Status: proposed for review

## 1. Executive Summary

The first exam product should be a narrowly scoped, temporary computational
scratchpad hosted on a reusable CoCalc private project host.

An instructor prepares an on-demand private host in advance, selects an exact
root filesystem, configures capacity, and creates an exam run with a required
automatic stop time. Students visit one stable exam URL, enter a shared access
token, and receive one anonymous, isolated, temporary CoCalc project. They can
use Jupyter notebooks, files, terminals, and software already present in the
pinned root filesystem. Their project has no outbound network access.

The student-facing application, authentication, project metadata, Conat
traffic, files, terminals, and Jupyter traffic should all be served by the
project host through one origin. The central hub is the control plane for
instructors, host lifecycle, and durable run configuration, but is not in the
steady-state student data path.

At the configured deadline, admission closes, temporary projects and their
data are deleted, and the VM stops. The private host itself remains available
for reuse, including its stable hostname and cached root filesystem images.

This is not an assessment delivery, grading, identity, proctoring, or learning
management system. The MVP is deliberately comparable to an isolated,
browser-based calculator or Sage Cell with full CoCalc notebooks and terminals.

## 2. Non-Negotiable MVP Scope

The first version is complete only if it provides all of the following:

1. Exam mode is available on a managed GCP private project host.
2. Exam hosts use on-demand instances, not spot instances.
3. The host has one stable exam hostname suitable for a lockdown-browser
   allowlist.
4. The project host serves the complete student application from that origin.
5. A shared, revocable exam token creates one anonymous local workspace per
   browser session.
6. Student accounts and projects are local to the project host; they are not
   normal global CoCalc accounts or centrally retained projects.
7. Every workspace uses the exact root filesystem image and digest frozen when
   the exam run is opened.
8. Every workspace has a fixed CPU, memory, and disk quota.
9. The instructor sets a maximum number of workspaces.
10. Outbound project network access is disabled and verified fail-closed.
11. Jupyter notebooks, files, terminals, kernels, autosave, and TimeTravel work
    locally while the workspace exists.
12. Rustic backups and project snapshots are disabled.
13. A required, editable, and cancellable automatic stop time is persisted.
14. Deadline handling survives hub, project-host process, and VM restarts.
15. Stopping an exam closes admission, deletes exam workspaces, and then stops
    the VM without deleting the reusable host.
16. The instructor can immediately stop and erase an exam run.
17. Existing private-host billing remains unchanged.
18. The product has an operator/instructor status UI, a documentation page, and
    a public landing page.

No item in the deferred wishlist in section 18 should be implemented as part of
the first version.

## 3. UCL Acceptance Scenario

The MVP should satisfy this concrete flow:

1. A UCL instructor creates an on-demand private project host well before the
   exam and chooses enough capacity for the expected class.
2. The instructor chooses and freezes the root filesystem to be used.
3. The instructor can rehearse using the same host, hostname, software image,
   and network policy.
4. Thirty to sixty minutes before the exam, the instructor starts the host and
   creates or opens an exam run with a mandatory stop time.
5. CoCalc runs an automated readiness check.
6. The instructor gives students one URL and one shared token.
7. Each student receives a clean anonymous project with no outbound network.
8. Students use CoCalc as a computational scratchpad and copy answers to the
   institution's separate assessment system or paper answer sheet.
9. At the deadline, new admission stops, student projects are erased, and the
   VM stops automatically.
10. The instructor may later restart the same trusted host for another exam.

The instructor does not upload questions, assign students, collect submissions,
grade work, or map workspaces to student identities in this version.

## 4. Product Terminology

Use these terms consistently in code, UI, documentation, and operations:

- **Exam host:** A reusable private project host with exam mode enabled.
- **Exam configuration:** Stable host-level choices such as hostname, capacity,
  workspace quotas, and permitted root filesystem images.
- **Exam run:** One time-bounded period with a frozen configuration, access
  token, admission state, and stop deadline.
- **Exam session:** One anonymous browser session admitted to an exam run.
- **Exam workspace:** The local project created for an exam session.
- **Stop and erase:** Close admission, delete run workspaces and local session
  data, then stop the VM.

Avoid calling an exam session a student account in user-facing text. It is not a
durable CoCalc identity.

## 5. Architecture And Data Authority

This design follows `src/.agents/scalable-architecture.md`.

### 5.1 Bay-owned control-plane state

The bay that owns the private host is authoritative for:

- Whether exam mode is enabled for the host.
- The stable exam hostname.
- Instructor authorization.
- Exam configuration.
- Exam run creation and state.
- Frozen root filesystem and quota configuration.
- Scheduled stop time.
- Host desired state and cloud lifecycle.
- Aggregate readiness and session counts.
- Normal billing and spending enforcement.

Instructor mutations must route to the host's authoritative bay. Do not assume
the local hub database owns the host.

### 5.2 Project-host-owned data-plane state

The project host is authoritative for:

- The active run snapshot used during a hub outage.
- The hashed exam access token used for local admission.
- Anonymous local account IDs.
- Local exam project IDs and collaborator mappings.
- Browser-session cookies.
- Workspace files, terminals, kernels, and TimeTravel.
- Local admission count and capacity enforcement.
- Local deadline enforcement and cleanup progress.

This state belongs in the project host's existing local SQLite and project
storage architecture. Do not create global accounts or central project rows for
students.

### 5.3 Student data path

Once an exam run is open, normal student traffic should be:

```text
lockdown browser <-> exam hostname <-> project host
```

The central hub must not proxy files, terminals, Jupyter, Conat, or application
traffic. A temporary hub outage must not interrupt an already admitted student.

### 5.4 Narrow public HTTP exception

The anonymous join action requires a small unauthenticated HTTP endpoint on the
project host because a new browser does not yet have a Conat identity.

This endpoint must be specific to exam admission. It must not become a generic
HTTP API for creating arbitrary accounts, projects, or collaborator mappings.
All authenticated instructor and control-plane operations should use Conat RPC.

## 6. Proposed Persistent Data Model

Use explicit tables rather than placing security-sensitive run state in the
generic `project_hosts.metadata` JSON field.

### 6.1 Central exam-host configuration

Add a bay-authoritative table such as `project_host_exam_configs`:

```text
host_id                     uuid primary key
enabled                     boolean not null
hostname                    text unique not null
hostname_generation         bigint not null
max_workspaces              integer not null
workspace_cpu               real not null
workspace_memory_mb         integer not null
workspace_disk_mb           integer not null
workspace_ttl_minutes       integer not null
terminal_enabled            boolean not null
network_mode                text not null
created_at                  timestamptz not null
updated_at                  timestamptz not null
created_by                  uuid not null
updated_by                  uuid not null
```

`network_mode` should be typed so future modes can be represented, but the MVP
API must accept only `disabled`.

### 6.2 Central exam runs

Add a bay-authoritative table such as `project_host_exam_runs`:

```text
run_id                      uuid primary key
host_id                     uuid not null
config_generation           bigint not null
status                      text not null
token_hash                  text not null
rootfs_image_id             text not null
rootfs_runtime_image        text not null
rootfs_digest               text not null
run_quota                   jsonb not null
max_workspaces              integer not null
network_mode                text not null
scheduled_stop_at           timestamptz not null
opened_at                   timestamptz
admission_closed_at         timestamptz
cleanup_started_at          timestamptz
cleaned_at                  timestamptz
stopped_at                  timestamptz
last_error                  text
created_at                  timestamptz not null
created_by                  uuid not null
```

The run row is a frozen snapshot. Changing the host's default exam
configuration must not alter an open run.

Only one nonterminal exam run may exist per host.

### 6.3 Project-host local state

Add small project-host SQLite tables for:

- The current run snapshot and generation.
- The token hash, never the plaintext token.
- Admission state and deadline.
- Anonymous session ID, local account ID, and local project ID.
- Session creation and expiry timestamps.
- Cleanup status and last error.

Do not record email address, name, institution identity, browser fingerprint, or
other unnecessary PII.

## 7. Exam Run State Machine

Use an explicit, persisted state machine:

```text
configured
  -> preparing
  -> ready
  -> open
  -> closing
  -> cleaning
  -> stopped
```

`error` is a recorded condition, not permission to skip cleanup.

Required transition rules:

- `preparing` starts or verifies the on-demand VM, synchronizes the run
  snapshot, installs the network policy, caches the rootfs, and runs readiness.
- `ready` permits instructor testing but not anonymous admission.
- `open` is the only state that accepts the shared token.
- `closing` rejects new admissions immediately.
- `cleaning` revokes sessions and removes every run-owned workspace.
- `stopped` requires cleanup completion or an explicit dirty-stop marker.
- Configuration affecting isolation, rootfs, or quotas is immutable after
  entering `open`.
- Repeated transition requests are idempotent.
- A stale or duplicated command must not create a second run or reopen a closed
  run.
- An expired run can never transition back to `open`.

Every state-changing RPC should accept an idempotency key.

## 8. Stable Single-Origin Student Application

### 8.1 Hostname

Allocate one stable random hostname when exam mode is first enabled, for
example:

```text
exam-<random-id>.exam.cocalc.ai
```

The hostname should remain assigned to the reusable host across runs and VM
stops. It should use the existing robust project-host route reconciliation
mechanism rather than a one-shot DNS update.

The random hostname reduces accidental discovery but is not an authorization
mechanism. The run token is the authorization mechanism.

### 8.2 Full static application

The project-host artifact must package and serve the pinned CoCalc static
application and assets locally. Reuse or extract the static-serving logic from
`src/packages/lite/http.ts`; do not maintain a second unrelated static-server
implementation.

The exam page must not load JavaScript, CSS, fonts, analytics, or other runtime
assets from external origins. This is necessary for lockdown-browser
compatibility and resilience.

The project host currently serves `/customize` but not the complete static
application. Packaging and serving the static bundle is therefore explicit MVP
work.

### 8.3 Same-origin routing

The exam origin must handle:

- The join page and join POST.
- `/customize`.
- Static application assets.
- Host-local Conat WebSockets.
- Browser-session bootstrap and cookie validation.
- Project files.
- Terminals.
- Jupyter kernels and notebooks.
- Project application proxy routes needed by the MVP.
- Deep-link fallback for normal application routes.

Add direct integration tests for the root URL and representative deep links.
Do not rely on a generic central server catch-all to make a new top-level route
work.

### 8.4 Exam-specific customization

When the request uses the exam hostname, `/customize` should put the frontend in
a narrow exam mode that:

- Shows only the current workspace.
- Hides account management, billing, upgrades, collaborators, sharing, and
  public publishing.
- Hides AI features and external-service integrations.
- Hides host administration from student sessions.
- Hides project movement, duplication to another host, and account invitations.
- Keeps files, Jupyter, terminals, kernels, TimeTravel, and necessary software
  launchers.
- Avoids links or UI actions that navigate to external origins.

Do not infer permission solely from the `Host` header. The exam hostname selects
the presentation; the signed local session and local project membership grant
access.

## 9. Anonymous Admission And Local Sessions

### 9.1 Join flow

The student flow is:

1. `GET /` shows a minimal host-served join page if no valid exam session cookie
   exists.
2. The student enters the shared exam token.
3. `POST /exam/join` validates the token, run state, deadline, rate limit, and
   workspace capacity.
4. The project host creates a random local account UUID.
5. The project host creates one local project UUID with the frozen rootfs,
   quotas, backup settings, and disabled network policy.
6. The account is added only to that local project's `users` mapping.
7. The project starts only after network isolation is installed and verified.
8. The project host issues its existing HMAC browser-session cookie with an
   expiry bounded by the run deadline plus a small cleanup grace period.
9. The browser is redirected to the workspace.

The existing project-host browser-session and local project authorization code
should be extended rather than replaced.

### 9.2 Session behavior

- Multiple tabs in the same browser reuse the same exam session and workspace.
- Reloading the join page must not create another workspace.
- A different fresh browser session creates a different workspace.
- A new exam run invalidates all cookies from prior run generations.
- Closing admission prevents new sessions but does not immediately interrupt
  existing sessions before cleanup begins.
- Deleting the local project and collaborator row revokes subsequent access.
- Session cookies must be Secure, HttpOnly, SameSite, origin scoped, and short
  lived.

### 9.3 Token handling and abuse controls

- Generate a high-entropy server-side token.
- Store only a memory-hard hash centrally and locally.
- Display the plaintext token only when created or explicitly rotated.
- Support token rotation before opening the run.
- Rate-limit failures by source IP and host.
- Add bounded exponential delay for repeated failures.
- Enforce `max_workspaces` atomically.
- Do not accept account IDs, project IDs, rootfs choices, or quotas from the
  anonymous client.
- Do not log the plaintext token.

Registration tokens used for ordinary CoCalc signup are unrelated and should
not be reused for exam admission.

## 10. Root Filesystem And Resource Invariants

The exact student software environment is part of the exam definition.

At run creation:

- Resolve the selected rootfs entry to its immutable image ID, runtime image,
  and digest.
- Persist all three in the frozen run snapshot.
- Reject mutable or unresolved image references.
- Pre-pull and verify that exact digest on the host.
- Run readiness using the same image and quotas as students.

Every exam workspace must receive:

- The frozen rootfs digest.
- The same CPU allocation.
- The same memory allocation.
- The same disk allocation.
- The same network policy.
- The same enabled application set.

Do not silently upgrade the rootfs during an open run. A new image requires a
new run and a new readiness test.

The host may be deliberately overprovisioned for predictable exam performance.
The UI should show the declared maximum workspaces and aggregate requested
resources so the instructor can detect obvious overcommitment.

## 11. Outbound Network Isolation

Network isolation is a correctness requirement, not an optional security
enhancement. Exam admission must fail closed if isolation cannot be installed
or verified.

### 11.1 MVP network mode

The only MVP mode is:

```text
disabled
```

Do not implement allowlists or unrestricted networking in the first version,
even if the schema anticipates them.

### 11.2 Implementation direction

The project runner currently uses a rootless Podman network and host-side
`pasta`, while the bootstrap code already associates project traffic with
project cgroups and installs nftables rules. Extend that existing mechanism to
apply a per-project exam network policy.

A plain Podman `--network=none` is not sufficient unless testing proves it
preserves every required host-local CoCalc path. The project still needs local
Conat, Jupyter, file, terminal, and published project-port communication.

For an exam workspace, the host firewall should:

- Allow established and related reply traffic needed by permitted local
  connections.
- Allow only explicitly required project-host-local service addresses and
  ports.
- Reject all new IPv4 egress to nonlocal destinations.
- Reject all new IPv6 egress to nonlocal destinations.
- Reject external DNS over UDP and TCP.
- Reject direct-IP access that bypasses DNS.
- Continue blocking cloud metadata endpoints.
- Install policy before starting user processes.
- Remove policy when the workspace is deleted.

The project process and its user-controlled descendants must remain in the
policy's cgroup. Student `sudo` inside the rootless container must not be able to
alter host nftables or move processes out of the host cgroup.

### 11.3 Required black-box network tests

From inside an exam project, verify that all of these fail:

- DNS resolution of an external name.
- HTTP and HTTPS by hostname.
- HTTP and HTTPS by literal IPv4 address.
- IPv6 connection to an external literal address.
- Raw TCP and UDP sockets to external addresses.
- `git clone` from a public host.
- `pip`, `npm`, or equivalent package download.
- Use of inherited proxy environment variables.

At the same time, verify that all of these continue to work:

- Host-local Conat.
- File reads, writes, and autosave.
- Terminal input and output.
- Jupyter kernel start, execute, interrupt, and restart.
- Project application proxying required by the exam UI.
- Browser reconnect after a temporary WebSocket interruption.

Readiness must run a short form of these checks on the actual host before
admission can open.

## 12. Backups, Snapshots, TimeTravel, And Cleanup

Exam workspaces must be marked as host-local exam projects and excluded from
normal backup and snapshot maintenance.

For the MVP:

- Rustic backup schedule is `none`.
- Project snapshots are disabled.
- No project data is copied to another host or bay during cleanup.
- No standard project drain or migration path is used.
- TimeTravel remains normal local project data while the workspace exists.
- Hard deletion of the project removes its TimeTravel with the rest of its
  files.

Stop-and-erase must delete:

- Every project and project volume owned by the run.
- Local anonymous account rows.
- Local collaborator mappings.
- Browser-session records or run generations that could restore access.
- Run-specific temporary files and logs containing student content.
- Run-specific firewall and cgroup policy.

Cleanup must verify the absence of run-owned projects and volumes before
reporting success.

The reusable host, stable hostname, project-host installation, and cached
rootfs images remain. The VM and its reusable host disk are not automatically
destroyed.

An abrupt infrastructure-level power loss cannot execute in-guest cleanup. On
the next boot, an expired or dirty exam run must complete cleanup before the
project host accepts admission or serves an old workspace. This limitation
should be documented accurately rather than hidden.

## 13. Restart-Safe Scheduled Shutdown

A required automatic stop time is part of every exam run. It must not be an
in-memory timer owned by one hub process.

### 13.1 Instructor behavior

The instructor must be able to:

- Set an absolute stop time with an explicit timezone.
- See the corresponding duration and estimated maximum host cost.
- Extend or shorten the deadline.
- Cancel the current scheduled stop only by closing the run or replacing it
  with another valid future deadline.
- Stop and erase immediately.

An open run may never have a null deadline.

### 13.2 Central reconciler

Add a durable bay-level reconciliation loop that:

- Runs at process startup and periodically.
- Queries nonterminal runs due for closure.
- Claims work using database locking or a lease.
- Transitions the run to `closing`.
- Sets the host's desired state to stopped before generic lifecycle
  reconciliation can restart it.
- Commands project-host cleanup when reachable.
- Stops the cloud VM after cleanup or after a bounded timeout.
- Is idempotent across duplicate workers and process restarts.
- Emits an admin notification on repeated failure or dirty stop.

The generic host lifecycle reconciler must treat an expired exam run as a
higher-priority stop condition than a stale `desired_state=running`.

### 13.3 Host-local watchdog

Project a signed run snapshot and deadline to persistent host-local state. Add a
root-owned systemd timer or equivalent host watchdog that survives
project-host-process restarts.

At the deadline it should:

1. Close local admission.
2. Revoke active run sessions.
3. Stop and delete exam projects.
4. Verify local cleanup.
5. Record cleanup success or dirty state locally.
6. Power off the VM.

If cleanup fails, the watchdog should power off after a bounded interval to cap
spending, retain a dirty marker, and require cleanup before admission on the
next boot.

### 13.4 Boot invariant

On every VM boot, before normal exam service starts:

- Read persistent local exam state.
- If the run is expired, close admission and clean it.
- If the run is dirty, resume cleanup.
- Refuse to serve old exam workspaces.
- Power off again if the central control plane incorrectly restarted an
  expired run.

This dual central and local design makes the deadline converge despite hub
restarts, temporary network partitions, or a project-host process crash.

## 14. Billing Behavior

Do not add exam-specific billing logic in the MVP.

- Starting an exam host uses existing private-host billing.
- The host must have sufficient normal funds or credit.
- Existing spending enforcement remains authoritative.
- Billing exhaustion may stop the host.
- The UI must not promise uninterrupted execution after funds are exhausted.
- UCL instructors may receive manually applied credit outside this feature.
- No site-license allocation, internal credit bucket, exam reservation, or
  automatic overage is implemented.

The start dialog should clearly show:

- On-demand machine type.
- Current hourly price.
- Scheduled run duration.
- Estimated maximum host cost.
- Current account balance or existing billing warning, using current billing
  APIs.

The product should be usable by any eligible paying user without a separate
commercial arrangement. Initial production rollout may still use a feature
flag or allowlist for operational safety.

## 15. Instructor And Operator UI

Add an **Exams** section to the private-host UI.

### 15.1 Configuration panel

The panel should support:

- Enable or disable exam mode while no run is active.
- Display the stable exam hostname.
- Select an immutable rootfs entry.
- Set maximum workspaces.
- Set per-workspace CPU, memory, and disk.
- Set workspace expiry and cleanup grace within safe bounds.
- Enable or disable the terminal if UCL confirms this choice is needed.
- Display network mode as fixed to `Disabled`.
- Save configuration through the authoritative bay.

Only host owners or managers with fresh authorization may mutate this
configuration.

### 15.2 Run preparation

The instructor should be able to:

- Start the on-demand host.
- Set the mandatory stop time.
- Run readiness.
- See each readiness check and its result.
- Create or rotate the shared token.
- Open admission.
- Copy the exam URL and token.

### 15.3 Active-run status

Show:

- Host and public-route health.
- Frozen rootfs digest.
- Admission open or closed.
- Active workspace count and configured maximum.
- Countdown to automatic stop.
- Normal hourly host price and estimated remaining cost.
- Network-isolation verification status.
- Last local heartbeat and deadline-watchdog status.
- Actions to extend, shorten, close, or stop and erase.

Do not show student identity because none is collected.

### 15.4 Dangerous actions

When an exam run exists, the normal host Stop action should route through or
explicitly require the exam stop-and-erase workflow. It must not accidentally
invoke the standard backup, drain, or migration behavior.

Immediate stop-and-erase requires fresh authorization and a clear confirmation
that all anonymous workspace data will be permanently deleted.

## 16. Readiness And Operational Checks

Admission may open only after all required checks pass:

- The VM is on-demand and running.
- Project-host and static-application versions match.
- The stable exam hostname resolves to the current host route.
- HTTP and WebSocket public probes pass through the exam hostname.
- The exact frozen rootfs digest is cached and verified.
- CPU, memory, disk, and workspace limits fit within configured host capacity.
- The local watchdog has the correct future deadline.
- Central and local run generations match.
- Network policy installation succeeds.
- A synthetic smoke workspace can be created and started.
- The smoke workspace can write a file.
- A Jupyter kernel can start and execute code.
- Required host-local WebSocket and reconnect paths work.
- External network checks fail as expected.
- The smoke workspace can be deleted with no residual volume or session.

The readiness result should be durable and invalidated by:

- Host recreation or IP/route change.
- Rootfs change.
- Project-host software upgrade.
- Exam configuration generation change.
- Network-policy verification failure.
- Deadline expiry.

For the first UCL production use, also run a manual capacity rehearsal using the
expected number of concurrent notebook kernels or a representative load.

## 17. Security And Privacy Requirements

- Use cryptographically random hostnames, tokens, session IDs, account IDs, and
  project IDs.
- Treat the shared token as a bearer secret.
- Store only token hashes.
- Never place the token in URL query parameters, fragments, analytics, or
  referrer-visible locations.
- Require same-origin POST and CSRF protection for admission.
- Use a restrictive Content Security Policy with no external runtime assets.
- Do not expose central hub credentials to student browsers or projects.
- Do not trust anonymous request fields for project configuration.
- Isolate each session to exactly one local project.
- Reject stale run generations everywhere.
- Bound admission attempts, session count, disk, memory, CPU, process count,
  and project creation rate.
- Avoid logging notebook content, terminal content, filenames, tokens, or other
  student data.
- Retain only aggregate operational counts centrally.
- Send admin notifications for route failure, watchdog disagreement, repeated
  cleanup failure, dirty shutdown, or unexpected restart of an expired run.
- Fail closed when authorization, network isolation, rootfs verification, or
  run-state validation is uncertain.

## 18. Explicitly Deferred Wishlist

Everything in this section is out of scope for the first version. It may inform
interfaces and schema naming, but it must not add code paths, UI controls, or
delivery risk to the MVP.

### 18.1 Billing and institutional commerce

- Site-license exam credit pools.
- Automatic allocation of campus-license value to exam usage.
- Reserved exam capacity billing.
- Fixed-price exam windows.
- Billing-exhaustion grace periods.
- Continue-running behavior with administrative overage.
- Departmental chargeback and cost-center reporting.
- Purchase orders or seat-based exam pricing.

### 18.2 Identity and enrollment

- Stable student accounts.
- Email verification.
- `.edu` eligibility.
- Anonymous seat numbers.
- Student roster import.
- SSO, SAML, or OIDC.
- Identity mapping between workspace and student.
- Identity verification or photo checks.

### 18.3 Assessment workflow

- Uploading or authoring exam questions.
- Copying starter content into workspaces.
- Timed release of questions.
- Submission collection.
- Automatic workspace export.
- Grading or autograding.
- Rubrics and feedback.
- Grade passback.
- Late-submission rules.
- Accommodations and per-student time extensions.
- Instructor-student messaging during an exam.

### 18.4 LMS and assessment-platform integration

- LTI 1.3 and LTI Advantage.
- Moodle, Canvas, Blackboard, or Brightspace integration.
- WISEflow or Inspera submission integration.
- Roster sync.
- Automatic assignment fetch and submission return.
- Deep linking from a course or assessment.

### 18.5 Network modes

- Domain or IP allowlists.
- Controlled access to GitHub or package repositories.
- Fully enabled internet.
- Instructor-managed egress policies.
- DNS-aware egress proxies.
- Per-application network permissions.

If allowlists are implemented later, prefer a controlled DNS and HTTP CONNECT
egress proxy over static hostname-to-IP nftables rules.

### 18.6 Retention, review, and TimeTravel

- Instructor access to student workspaces.
- TimeTravel review of what a student typed.
- Replay or audit timelines.
- Configurable post-exam retention.
- Legal holds.
- Exports to institution storage.
- Selective preservation of specific workspaces.
- Academic-integrity analysis.

TimeTravel requires no separate cleanup in the MVP because it is project data
and disappears when the project is deleted.

### 18.7 Proctoring and lockdown

- A CoCalc native lockdown browser.
- Webcam proctoring.
- Screen recording.
- Browser-process monitoring.
- Copy/paste prevention.
- Plagiarism detection.
- Device attestation.
- Integration with commercial proctoring agents.

The MVP only provides a single stable origin that an institution's existing
lockdown browser can allow.

### 18.8 Expanded compute and application platform

- Network-enabled examinations.
- Arbitrary instructor-defined web applications.
- One-click RStudio, VS Code, desktop, or custom app catalogs specifically for
  exams.
- GPU exam hosts.
- Multi-host exams and autoscaling.
- Cross-region failover.
- Spot exam hosts.
- Kubernetes exam backends.
- Self-hosted exam mode.
- Cloud providers other than the currently managed GCP host path.
- Native mobile applications.

The pinned rootfs may already contain additional software, but the MVP should
not build a new generic exam application marketplace.

### 18.9 Lifecycle automation

- Scheduled host start.
- Calendar-based recurring exam windows.
- Automatic host right-sizing.
- Automatic creation or destruction of the private host.
- Automatic deletion of the reusable host disk.
- Warm standby hosts.
- Cross-host disaster recovery during an active exam.

### 18.10 Marketing expansion

- Institution case studies.
- Public capacity calculators.
- Self-service institutional procurement.
- Competitive comparison pages.
- Partner certification with lockdown-browser vendors.
- Claims about assessment delivery, grading, proctoring, or academic-integrity
  enforcement.

## 19. API And Code Organization

Prefer Conat RPC for instructor and control-plane operations.

Likely central API additions:

- Get and update exam-host configuration.
- Create an exam run.
- Get current run and readiness.
- Start preparation.
- Rotate token.
- Open and close admission.
- Update scheduled stop time.
- Stop and erase.

Likely project-host RPC additions:

- Apply a signed run snapshot.
- Prepare and verify a run.
- Report readiness.
- Report aggregate workspace count.
- Close admission.
- Clean run workspaces.
- Report watchdog and cleanup state.

Likely project-host local modules:

```text
src/packages/project-host/exam/config.ts
src/packages/project-host/exam/controller.ts
src/packages/project-host/exam/admission.ts
src/packages/project-host/exam/cleanup.ts
src/packages/project-host/exam/watchdog.ts
src/packages/project-host/exam/readiness.ts
```

Likely project-runner work:

- Add a typed per-project network policy.
- Pass the policy through the existing run-quota/runtime path.
- Extend host nftables reconciliation for exam project cgroups.
- Add verification and cleanup commands.

Likely frontend work:

- Add an Exams panel to the existing private-host interface.
- Add run preparation, status, and stop dialogs.
- Add the narrow exam customize mode used by the local static application.

Exact filenames may change during implementation, but ownership boundaries
should not.

## 20. Testing Plan

### 20.1 Unit tests

Cover:

- On-demand-only validation.
- Configuration authorization and bay routing.
- Run snapshot freezing.
- Rootfs digest resolution.
- Token generation, hashing, rotation, and rejection.
- Atomic maximum-workspace enforcement.
- Local session reuse and expiry.
- Run-generation invalidation.
- Local project membership isolation.
- Network-policy rule rendering.
- Scheduled-stop claims and idempotence.
- Expired-run precedence over stale desired state.
- Cleanup idempotence.
- Dirty-run boot behavior.
- Backup and snapshot exclusion.

### 20.2 Project-host integration tests

Cover:

- Static application and deep links from the exam origin.
- Anonymous join and redirect.
- Two fresh browsers receiving different projects.
- Two tabs in one browser reusing one project.
- One session being unable to access another session's project.
- Jupyter, terminal, files, autosave, and reconnect.
- Closing admission while existing sessions remain active until cleanup.
- Stop-and-erase removing every local session and project.
- Old cookies failing after a new run.

### 20.3 Failure and restart tests

Cover:

- Restart the hub during an open exam.
- Restart the project-host process during an open exam.
- Restart the VM before the deadline.
- Restart the VM after the deadline.
- Kill the central reconciler while it owns a due run.
- Duplicate central reconcilers handling the same deadline.
- Break central-to-host connectivity at the deadline.
- Break the public route while the local host remains healthy.
- Force cleanup failure and verify dirty-stop behavior.
- Verify an expired host cannot remain running due to stale desired state.

### 20.4 Network tests

Run the black-box checks in section 11 from an actual exam project on staging.
Do not accept mocked firewall tests as sufficient.

### 20.5 Lockdown-browser testing

Test the stable single-origin flow with the browser UCL actually uses. Confirm:

- The origin can be allowlisted once.
- Static assets load.
- WebSockets connect.
- Jupyter kernels work.
- Downloads, clipboard, and navigation behave as UCL expects.
- No hidden dependency requires `cocalc.ai` or a separate project-host domain.

## 21. Delivery Sequence

### Phase 1: Data model and control-plane skeleton

- Add central config and run tables.
- Add bay-routed typed APIs.
- Add state-machine validation and authorization.
- Add feature flag.

Exit criterion: an instructor can configure a host and create a frozen run
without any student admission.

### Phase 2: Host-local run controller and static origin

- Add local run persistence.
- Package and serve the full static application.
- Add exam customization.
- Add local admission, sessions, and projects.

Exit criterion: anonymous users can receive isolated local workspaces through
one origin on a development host.

### Phase 3: Fail-closed network isolation

- Add per-project network policy.
- Add host nftables reconciliation.
- Add required black-box tests.

Exit criterion: external network attempts fail while all required CoCalc
services continue to work.

### Phase 4: Cleanup and scheduled shutdown

- Add exam-specific stop-and-erase.
- Add central durable reconciler.
- Add host-local watchdog and boot invariant.
- Add dirty-run recovery and admin notifications.

Exit criterion: deadline cleanup and VM stop converge through deliberate hub,
process, and network failures.

### Phase 5: Instructor UI and readiness

- Add configuration and run panels.
- Add cost/deadline UI.
- Add readiness checks and active status.

Exit criterion: an instructor can operate the full workflow without database or
CLI access.

### Phase 6: Documentation and landing page

- Publish an operator guide.
- Publish a narrowly accurate public feature page.
- Add a pre-exam checklist and failure runbook.

Exit criterion: UCL can rehearse from the documentation without informal setup
instructions.

### Phase 7: Staging rehearsal

- Use an on-demand staging private host.
- Run full network and restart tests.
- Run representative notebook concurrency.
- Test the actual lockdown browser.
- Perform an end-to-end timed cleanup and stop.

Exit criterion: all acceptance checks pass and UCL confirms the workflow.

### Phase 8: Limited production rollout

- Enable one production exam host.
- Rehearse with UCL staff.
- Monitor one low-risk session.
- Run the first real exam with active operational coverage.
- Expand general availability only after reviewing the first runs.

## 22. Documentation And Marketing Deliverables

### 22.1 Documentation page

The documentation should explain:

- What Exam Scratchpad is and is not.
- How to create and size an on-demand private host.
- How to pin and rehearse a rootfs.
- How to configure a run and required stop time.
- How to run readiness.
- How to distribute the URL and token.
- How disabled networking is verified.
- How normal billing applies.
- How to extend, close, or stop and erase.
- What data is deleted.
- The abrupt-power-loss retention caveat.
- A day-before and 60-minutes-before checklist.
- A failure and support runbook.

### 22.2 Landing page

Suggested primary positioning:

> Real computational tools inside locked-down exams.

Supporting claims should remain limited to implemented behavior:

- A clean browser-based Linux workspace for every candidate.
- Jupyter notebooks, terminals, and the institution's chosen software.
- One stable origin for lockdown-browser configuration.
- A pinned, rehearsable software environment.
- Disabled outbound project networking.
- Anonymous temporary workspaces with automatic cleanup.
- On-demand capacity that stops on schedule.
- No separate exam cluster to operate.

Do not market the MVP as a replacement for WISEflow, Inspera, Moodle, Canvas,
proctoring software, or an institution's grading workflow. Position it as the
computational scratchpad those systems do not provide.

TimeTravel may be mentioned only accurately: it exists within each temporary
workspace while that workspace exists and is deleted with the workspace.
Instructor review or retention of TimeTravel is deferred.

## 23. Observability And Runbook

Record metrics without student content or identity:

- Host readiness duration and failures.
- Public route health.
- Active exam runs.
- Admission attempts, successes, and rate-limit rejections.
- Current and maximum workspace count.
- Workspace create/start latency.
- Kernel smoke-test latency.
- Network-policy verification failures.
- Central/local deadline disagreement.
- Cleanup duration and residual-resource failures.
- Dirty stops and unexpected expired-host restarts.
- VM stop completion.

Alert administrators on:

- Readiness failure near an announced exam.
- Public route failure.
- Local watchdog heartbeat missing.
- Deadline disagreement.
- Workspace capacity exhaustion.
- Repeated admission errors.
- Network fail-open or unverifiable state.
- Cleanup failure.
- VM still running after the deadline and grace period.

Create a concise operator runbook for:

- Route failure.
- Rootfs pull failure.
- Capacity exhaustion.
- Host restart.
- Hub outage.
- Network-policy failure.
- Emergency close.
- Dirty cleanup.
- Manual cloud stop after the deadline.

## 24. Definition Of Done

The MVP is done when:

- The UCL acceptance scenario in section 3 works end to end.
- All student runtime traffic uses one exam origin.
- No global student accounts or projects are created.
- The exact rootfs and quotas are frozen and visible.
- Network isolation passes real IPv4, IPv6, DNS, and direct-IP tests.
- Normal CoCalc files, Jupyter, terminal, autosave, and reconnect work.
- No backups or snapshots are created for exam workspaces.
- Automatic deadline handling survives deliberate central and local restarts.
- Stop-and-erase deletes all workspace data and stops the VM.
- The reusable host and cached rootfs remain.
- Existing billing behavior is unchanged and accurately disclosed.
- Documentation and the landing page describe only implemented capabilities.
- A staging lockdown-browser rehearsal succeeds.
- No deferred wishlist feature was pulled into the first release.

## 25. Review Decisions

The following decisions should be confirmed before implementation starts:

1. Confirm the exact UCL lockdown browser and its hostname/WebSocket rules.
2. Confirm whether the terminal must be enabled in the first UCL run.
3. Choose safe minimum and maximum workspace TTL values.
4. Choose the cleanup grace period before forced VM poweroff.
5. Confirm the first supported managed GCP private-host configurations.
6. Confirm the stable exam hostname suffix.
7. Confirm whether the initial production feature flag is account allowlisted
   or admin enabled per host.
8. Confirm the minimum operational capacity rehearsal for UCL's first exam.

None of these decisions should expand the MVP into identity, assessment
delivery, submission, grading, special billing, or proctoring.
