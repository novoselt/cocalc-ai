# Automatic Project Archive Lifecycle

Status: implementation plan.

Date: 2026-08-22.

## Goal

Automatically move inactive free projects and projects belonging entirely to
banned accounts from expensive project-host storage into the existing rustic
archive representation, without disrupting paying customers, published
content, or active project runtimes.

This is a storage lifecycle policy, not a new archive format or a new delete
pipeline. It must reuse the existing `archiveProject` and restore paths so that
automatically archived projects behave exactly like projects archived by a
user.

## Product Policy

### Free inactive projects

A project is eligible for automatic archival when all of the following are
true:

1. The project has no non-banned collaborator with a current paid entitlement.
2. The project has no active published path.
3. The project has not been edited for 30 days, measured on that project using
   `COALESCE(projects.last_edited, projects.created)`.
4. The project is definitely stopped and in a stable state.
5. The project is not already archived, deleted, or protected from destructive
   storage actions.
6. The owning bay can resolve every collaborator's current ban and paid status
   and the project's current publication state. Unknown data makes the project
   ineligible.

The 30-day clock is project-local. Activity in one of an account's projects
does not keep another project active.

`projects.last_edited` is intentionally the only activity signal in the first
implementation. Anything that currently updates `last_edited` counts as
activity. Do not build a separate activity taxonomy or attempt to prevent a
small number of users from intentionally extending the lifetime of a free
project.

### Paying-collaborator protection

A non-banned collaborator with a current paid entitlement protects the entire
project from automatic archival, with no inactivity limit. This is a customer
benefit and applies regardless of which collaborator owns the project.

The check must use the authoritative membership/entitlement resolver. Do not
infer payment status from project quotas, runtime priority, recent invoices, or
a local account row. Paid institutional, team, course, or site-license grants
must count when the normal entitlement resolver treats the collaborator as a
paying customer. A free trial counts only if product policy explicitly maps
that trial to the same paid entitlement.

A banned collaborator never provides paying-collaborator protection. If every
collaborator is banned, the banned-project policy below takes precedence even
if one of those accounts still has billing metadata.

### Published-path protection

Do not automatically archive a project with any active published path unless
every collaborator is banned.

The authoritative test is the project-owned `public_project_paths` data, not a
derived label or anonymous traffic counter. An active path is currently a row
for the project where:

```sql
disabled IS FALSE AND visibility <> 'disabled'
```

This protection applies even when the path is pending or temporarily
unavailable. Publishing is rare, is a strong indicator of a high-value
project, and currently depends on reading content directly from the project
host.

### Projects with all collaborators banned

A project is eligible seven days after every collaborator is banned. Use the
latest collaborator ban time, so the grace period begins only after the last
non-banned collaborator becomes banned.

This lane overrides paid-entitlement and published-path protection, but it
retains all storage-safety and non-running requirements. An unban or
collaborator change immediately invalidates a queued archive operation.

Account banning must independently and immediately make public content
attributable to the banned account unavailable. Ban containment should disable
every active share created or updated by the account and every active share in
a project owned by that account, including aliases and temporary viewer grants.
Public-share authorization must also reject banned creators, updaters, and
project owners so a failed or delayed cleanup cannot leave content reachable.
Unbanning never republishes content automatically. The seven-day archive lane
therefore normally sees no active shares, but it still overrides publication
protection as a fail-safe.

The current `accounts.banned` boolean does not provide a reliable timestamp,
and historical `account_ban_audit_log.created` values are null in production.
Before enabling this lane:

1. Add an authoritative `banned_at` timestamp at the account's authoritative
   home bay.
2. Set `banned_at` transactionally on a false-to-true ban transition.
3. Clear it on unban and set a new value on a later re-ban.
4. Fix `account_ban_audit_log.created` to default to `CURRENT_TIMESTAMP` and
   verify the production schema after migration.
5. Backfill currently banned accounts with the policy deployment time rather
   than inventing historical ban times. This gives all existing bans a fresh
   seven-day grace period.

An empty or unresolved collaborator set is not equivalent to "all banned" and
must fail closed.

### Deleted projects

There is no deleted-project archive lifecycle.

The current delete path immediately removes the project from active storage
and project tables through `hardDeleteProject`. Recovery data is retained by a
separate deleted-project tombstone and backup-retention policy, currently seven
days by default. That retention does not leave a deleted project consuming an
active project slot and does not make it eligible for this archive lifecycle.

The lifecycle selector must exclude deleted projects. Do not add a delayed
trash state or defer hard deletion, since that would complicate project-count
accounting and allow delete/undelete cycling to evade project limits.

## Non-Goals

- Do not archive running, starting, stopping, or otherwise busy projects.
- Do not stop a project in order to make it eligible for automatic archival.
- Do not change the free-project idle timeout as part of this work.
- Do not introduce a second backup, archive, or host-volume deletion path.
- Do not automatically delete archived projects or accounts.
- Do not use anonymous public traffic as an activity signal.
- Do not infer paid status from `run_quota` or project-host placement.
- Do not make a local bay authoritative for a remote account or project.

## Decision Order

The selector and final guard must use the same decision order:

1. Exclude deleted projects.
2. Exclude projects that are already archived or not provisioned.
3. Exclude projects protected from destructive storage operations.
4. Exclude every state except a canonical, stable, stopped state. Prefer an
   explicit allowlist, currently centered on `opened`, rather than a denylist
   of known running states.
5. Resolve the owning bay and current collaborator set.
6. If every collaborator is banned and the latest `banned_at` is at least seven
   days old, select the `all-collaborators-banned` reason.
7. Otherwise, exclude projects with any active published path.
8. Exclude projects with any non-banned paid collaborator.
9. Select `free-inactive` only when
   `COALESCE(last_edited, created) <= now() - interval '30 days'`.
10. Treat missing, stale, contradictory, or unresolved data as ineligible.

Keep the policy implementation in one shared module so reporting, candidate
selection, final execution guards, tests, and operator tooling cannot develop
different definitions of eligibility.

## Architecture

### Authority and routing

The project owning bay is authoritative for the lifecycle decision and archive
operation. Account ban and membership status remain authoritative at each
collaborator's home bay. Published paths remain authoritative with the project.

The owning-bay lifecycle service must use the normal inter-bay directory and
entitlement projections or a batched inter-bay service. It must not query the
local accounts database and assume every collaborator is local. Archive
execution must route through the project ownership/project-host routing layer,
not directly to a locally discovered host.

Launchpad remains the one-bay special case of this architecture. A site setting
may disable automatic archival there, but the policy and execution code should
not fork into a separate implementation.

### Candidate selection

Run a periodic, owning-bay maintenance job. Selection should first use cheap,
project-local filters:

- `deleted IS NOT TRUE`
- `provisioned IS TRUE`
- canonical stable stopped state
- `COALESCE(last_edited, created)` before the free cutoff, or a collaborator
  set that may qualify for the banned lane

Then resolve publication, collaborator, ban, and entitlement gates in batches.
Do not scan all accounts once per project.

Candidate selection is advisory. It must create or claim a durable,
idempotent lifecycle job keyed by project, archive reason, and policy version.
The job records the observed eligibility snapshot but does not make that
snapshot authoritative at execution time.

### Guarded archive execution

Reuse the existing server `archiveProject` implementation. Add a system-only
automation mode or guarded wrapper with explicit preconditions, rather than
duplicating its backup verification, host cleanup, state projection, and event
publication.

The guarded mode must differ from manual archiving in one important way:

- Manual archive may retain its existing behavior of stopping a project after
  user confirmation.
- Automatic archive must reject the operation if the project is not still in a
  stable stopped state. It must never call stop.

Immediately before the destructive host call, the owning bay must atomically
revalidate or claim:

- project state and `provisioned`
- `last_edited` and the applicable cutoff
- current collaborator membership
- every collaborator's current ban and paid status
- current active published paths
- destructive-storage protection
- project ownership/bay generation
- the lifecycle policy version

If any value changed, mark the job stale or canceled and leave the project
untouched. In particular, a project start racing with archival must win; the
automatic archive operation must not stop it.

Prefer a project lifecycle revision or transactional claim over a collection
of unrelated reads. The project-host deletion request should carry the
expected project/placement generation so stale work cannot delete data after a
move or restart.

### Existing archive safety audit

Before enabling automation, audit the current archive RPC and its
`deleteProjectDataOnHost` path rather than replacing them. Verify that it:

1. Requires a usable rustic repository and a current recoverable backup.
2. Does not treat a merely non-null `last_backup` timestamp as sufficient when
   the backup object is missing or older than the latest persisted project
   generation.
3. Removes every host-local project allocation that manual archival promises
   to remove, including relevant subvolumes and snapshots.
4. Preserves all metadata needed to place and restore the project later.
5. Is idempotent after partial failure and safe to retry.
6. Publishes the projected archive state and user-visible events only after the
   durable archive is recoverable.

The existing RPC can mark a project archived without host mutation when a host
is unavailable. That may be appropriate for a deprovisioned host, but it does
not reclaim storage on a live unreachable host. Automatic archival should
defer those projects unless the host is authoritatively deprovisioned, and it
should create explicit cleanup debt if local data may still exist.

### Restore behavior

Opening or starting an automatically archived project must use the same restore
path as a manually archived project. No special restore API is needed.

The project UI should expose the archive reason and time, for example:

- "Archived automatically after 30 days of inactivity."
- "Archived because all collaborators were banned."

Restoration must show durable progress, survive refresh/reconnect, and provide
an actionable retry state. A direct link to a file in an archived project must
route through the same restore flow and then reopen the requested path.

Published projects should not normally enter this state. Manual archive should
retain its existing warning that public shares become unavailable.

## Data Model and Audit

Add a durable project archive event/job record rather than relying only on the
project state timestamp. At minimum record:

- project ID and owning bay ID
- archive reason: `manual`, `free-inactive`, or
  `all-collaborators-banned`
- policy version and configured thresholds
- selector time, claim time, completion time, and actor (`system` or account)
- observed `last_edited`, project state, placement generation, and host ID
- collaborator IDs and the paid/ban decision snapshot, or a privacy-preserving
  reference to that snapshot
- publication-protection result
- backup repository, backup object/generation, and backup time used for restore
- archive RPC/job ID, attempts, terminal result, and failure category
- measured local bytes before and after cleanup when host accounting provides
  them

The project row may contain the latest archive reason/time for efficient UI
display, while the event table keeps history across restore and re-archive
cycles.

All writes must be idempotent. A unique active-job constraint on project ID
should prevent free and banned selectors from racing each other. The banned
reason takes priority when both appear possible.

## Configuration

Expose operator-adjustable site settings with conservative defaults:

- `automatic_project_archiving_enabled = false`
- `free_project_archive_after_days = 30`
- `banned_project_archive_after_days = 7`
- `automatic_project_archiving_report_only = true`
- global and per-host concurrency/rate limits
- optional bay/host canary allowlists

Threshold changes affect new eligibility decisions. Store the effective value
and policy version on every job so operators can explain historical actions.

Changing a threshold must not bypass final eligibility checks or mutate
already archived projects.

## Query and Index Work

Audit indexes before enabling the periodic scan. Likely requirements include:

- an index supporting non-deleted, provisioned projects ordered by
  `COALESCE(last_edited, created)`
- a partial `public_project_paths(project_id)` index for active paths
- efficient project-to-collaborator lookup
- efficient lookup of current account `banned`, `banned_at`, and entitlement
  projection by account ID
- an active lifecycle-job index by project and next-attempt time

The initial production estimate on 2026-08-22 found approximately 9,093
provisioned projects with free runtime priority and no edit for 30 days. This
is only a backlog estimate. Runtime priority is not an eligibility rule, and
the real selector will return fewer projects after paid-collaborator,
publication, state, and safety gates.

## Testing

### Policy unit tests

Cover the complete decision matrix:

- one project inactive for 31 days and another project for the same account
  active today
- inactive free project with no publication is eligible
- exactly 30 days at the cutoff is deterministic
- recent `last_edited` blocks archival
- null `last_edited` falls back to project creation time
- any non-banned paid collaborator blocks archival
- a paid collaborator from another bay blocks archival
- unknown or stale entitlement data blocks archival
- active published path blocks free archival
- disabled published path does not block archival
- pending but active published path blocks archival
- all collaborators banned for seven days is eligible despite publication
- one non-banned collaborator blocks the banned lane
- unban and collaborator changes cancel queued work
- deleted, archived, unprovisioned, protected, and busy projects are excluded
- an empty or unresolved collaborator set is excluded

### Race and failure tests

Cover execution behavior:

- project starts after selection but before claim
- project starts after claim but before project-host deletion
- `last_edited` advances after selection
- a published path is created after selection
- a collaborator becomes paid after selection
- a collaborator is added or unbanned after selection
- project moves to another host or bay after selection
- backup verification fails or the backup object disappears
- project host times out before, during, and after local cleanup
- hub or worker restarts during every durable job phase
- duplicate maintenance ticks and retries remain idempotent
- automatic mode never invokes project stop

### Archive and restore integration tests

Extend the existing `projects.archive.test.ts` coverage and add full-path
integration tests that:

1. Create and edit a project, ensure a current backup, stop it, and archive it
   through guarded automation.
2. Confirm the project becomes archived/unprovisioned and active-storage
   entitlement accounting changes exactly as it does for manual archive.
3. Confirm host-local project allocations are gone and the recorded rustic
   backup is readable.
4. Open the archived project, observe restore progress, and verify file content
   and metadata after restoration.
5. Refresh or disconnect during restore and confirm progress and completion
   remain correct.
6. Repeat with a direct file URL, a different destination host, and a project
   whose owning bay differs from the account home bay.
7. Exercise recoverable restore failure and retry.
8. Confirm a published project is never selected by the free lane.

Also smoke test manual archive and restore to ensure the automation guard does
not regress the existing user-visible RPC.

## Observability

Provide report-only and execution dashboards grouped by bay, host, and reason:

- candidates found, protected, queued, stale, completed, and failed
- exclusion counts by paid collaborator, published path, state, recent edit,
  unknown authority, and backup safety
- queue age and retry count
- bytes measured before and reclaimed after archival
- restore requests, duration, failures, and retry success
- archive attempts rejected because a project became active
- projects marked archived while host-local cleanup debt remains

Alert on repeated failures, unexpected stop calls, high restore failure rate,
or any project archived after a final guard reported paid, published, active,
or running.

## Rollout

### Phase 1: schema and audit fixes

1. Add and populate `accounts.banned_at` using a fresh deployment-time value
   for existing banned accounts.
2. Fix and verify the ban audit timestamp default.
3. Add archive event/job storage and required indexes.
4. Audit the archive/restore and host cleanup paths.
5. Add the guarded automatic mode to the existing archive RPC.

### Phase 2: report only

Run the selector without mutation for at least one week. Sample candidates from
both reasons manually and compare every exclusion against account membership,
publication, runtime, backup, and host state.

Produce an impact report with candidate count and estimated reclaimable bytes
per host. Verify that no project with an active published path or non-banned
paid collaborator appears in the free candidate set.

### Phase 3: banned-project canary

Enable a small canary for projects whose collaborators have all been banned for
at least seven days. Start with low global and per-host concurrency, inspect
archive evidence, and perform restores from sampled projects before widening.

The banned lane is operationally lower risk because users cannot access the
projects, but backup and restore correctness requirements remain identical.

### Phase 4: free-project canary

Enable a small host/bay canary for free projects inactive for 30 days. Prefer
the oldest eligible projects and, when reliable byte accounting is available,
the largest allocations. Do not shorten the inactivity threshold in response
to host pressure; host pressure may only change ordering among eligible
projects.

Keep automatic execution rate-limited, for example one archive operation at a
time per host with a conservative global hourly limit, until restore metrics
and support reports are stable.

### Phase 5: general availability

Enable all bays while retaining report-only comparison, final fail-closed
guards, rate limits, audit records, and a global kill switch. Review storage
savings and restore reliability before changing the 30-day threshold.

## Acceptance Criteria

- No project with an active published path is automatically archived unless
  every collaborator is banned and the ban grace period has elapsed.
- Banning an account immediately makes its published content unavailable;
  unbanning does not restore publication.
- No project with a non-banned paid collaborator is automatically archived.
- Free inactivity is computed from that project's `last_edited`, not account
  activity or another project.
- Automatic archival never stops a project and loses every race with project
  start or edit activity.
- Deleted projects remain on the immediate hard-delete and backup-retention
  path; no delete lifecycle is added.
- Automatic and manual archives use the same recoverable backup, local cleanup,
  projected state, and restore implementation.
- Opening an archived project restores it with visible, refresh-safe progress
  and intact files.
- Every automatic archive is explainable from a durable policy and evidence
  record.
- Operators can disable execution immediately without disabling manual archive
  or restore.
