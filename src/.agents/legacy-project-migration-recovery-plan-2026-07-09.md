# Legacy Project Migration Recovery Plan

Date: 2026-07-09

This plan is for finishing the CoCalc.com project migration from the sources that still exist. It assumes the old production disks and disk snapshots are gone. The remaining authoritative sources are the cocalc.ai production database, the read-only archive database/dumps, Cloudflare R2, the GCS archive bucket, the GCS streams bucket, and the old blob bucket.

The priorities are:

1. Be accurate and transparent with users immediately.
2. Freeze and inventory every remaining data source before more destructive or lifecycle actions.
3. Recover every project that can still be recovered from GCS into the cocalc.ai R2 restore format.
4. Explicitly classify projects that cannot be recovered, with evidence.
5. Keep a durable audit trail for every classification and recovery action.

## Current Facts

These are working facts from the inventories and repo history reviewed so far. Recompute before any final public numbers.

- Legacy projects in prod DB: about 4.23M.
- Observed R2 `.tar.zst` project backups: about 834k in the latest cocalc.ai inventory.
- GCS archive bucket `kucalc-prod2-archived-projects/default/project-*.tar`: about 4.20M objects, about 61 TB.
- Broad active-definition set previously computed: project active in last 5 years, or any collaborator active in last 2 years: about 2.15M projects.
- Broad active-definition projects with R2: about 731k.
- Broad active-definition projects missing R2 but present in GCS archive: about 1.27M.
- Broad active-definition projects missing both R2 and GCS archive: about 151k, pending streams-bucket inventory and stricter dataless/lost classification.
- The previous kucalc “coverage gate green” applied a narrower “qualified project” predicate, not the broad support-facing active-definition predicate. Do not reuse that as the final user-facing coverage statement.
- Legacy TimeTravel/timeline data from CoCalc.com is not recoverable from the project archive/R2 flow. Treat this as a separate, explicitly communicated loss.
- The full GCS streams-bucket inventory must be rerun in a durable/logged way. The prior live session stopped before writing the full output.

## Policy

Do not use the ambiguous status “Not available yet” as the main user-facing state. Users need to know whether a project is ready now, queued for conversion from a known backup, still being investigated, or unrecoverable.

Use conservative language:

- “Available now” only if the R2 `.tar.zst` object exists and passes the restore-object predicate.
- “Recoverable, queued for restore” only if a known source object exists in GCS archive or streams and the project is not already in R2.
- “Checking backup status” when the relevant source inventory is incomplete or stale.
- “No project data found” only when we have evidence that no project filesystem ever existed or no backup source exists after checking all remaining sources.
- “Legacy TimeTravel unavailable” as a separate statement from project file recovery.
- Avoid “lost” in UI labels unless the support/admin view has a clear evidence record. For direct support replies, be plain when data is irrevocably gone.

## Phase 0: Freeze Remaining Sources

Owner: CEO/operator.

Do this before running any large recovery computation.

- Confirm no lifecycle delete rules are enabled on:
  - `kucalc-prod2-archived-projects`
  - `kucalc-prod2-storage-streams`
  - old blob bucket
  - R2 `cocalc-projects`
- Confirm object versioning/soft delete status where available and record it.
- Save bucket configuration snapshots:
  - bucket location
  - storage class
  - lifecycle rules
  - IAM bindings
  - object versioning settings
  - retention/soft-delete settings
- Preserve all inventory files under a durable location, not only `/tmp` or a scratch disk.
- Treat `/run/secrets/cocalc/cocalc-legacy-gcs-readonly*.json` as sensitive credentials. Use them only for read-only inventory.
- Put R2 write credentials for recovery workers in a managed secret store, not in job specs or logs.

Deliverable: `legacy-migration-freeze-YYYYMMDD.md` with the exact source-state snapshot and the commands used.

## Phase 1: Fix User-Facing Status and Communication

This is the first product/code change because it reduces confusion while recovery is in progress.

### Replace Ambiguous Statuses

In the legacy migration UI and admin migration panel, replace “Not available yet” with a status derived from explicit fields:

- `available_now`
  - R2 object exists at `prod3/default/<project_id>.tar.zst`.
  - Restore button enabled.
  - Text: “Available now.”
- `recoverable_from_archive`
  - R2 missing.
  - GCS archive object exists at `gs://kucalc-prod2-archived-projects/default/project-<project_id>.tar`.
  - Restore button disabled until conversion completes, or triggers an on-demand conversion if implemented.
  - Text: “Recoverable. Queued for conversion from legacy archive.”
- `recoverable_from_streams`
  - R2 missing.
  - GCS archive missing.
  - GCS streams prefix exists with usable `*.lz4` and/or `bup/`.
  - Text: “Recoverable from legacy stream backup. Queued for reconstruction.”
- `checking_backup_status`
  - R2 missing and the relevant GCS inventory is incomplete/stale.
  - Text: “Checking backup status. We are still scanning legacy backups.”
- `no_project_files_found`
  - No R2 object, no archive tar, no streams data, and DB evidence supports dataless classification.
  - Text: “No project files were found in the legacy backups.”
- `backup_not_found`
  - No R2 object, no archive tar, no streams data, and there was evidence of activity that prevents calling it dataless.
  - Text: “No recoverable project backup was found.”
- `restore_failed`
  - A conversion/import job failed after trying a known source.
  - Text: “Restore conversion failed. Support has been notified.”

Keep an admin-only evidence panel for each project:

- R2 object existence, size, modified time.
- GCS archive object existence, size, updated time.
- GCS streams prefix existence, total objects, total bytes, newest lz4 timestamp, bup master timestamp if known.
- DB `created`, `last_edited`, `last_started`/`last_active` fields used by the migration system.
- Collaborator count.
- Legacy project state and deleted flag.
- Recovery job status and logs.
- Final classification and who/what set it.

### TimeTravel Banner

Add a clear statement in the legacy migration page and support macros:

> Migrated projects contain recovered project files. Legacy CoCalc.com TimeTravel history was not preserved and cannot be restored. New TimeTravel history starts on CoCalc.ai after migration.

This should be separate from project-file availability so users do not conflate missing TimeTravel with missing project files.

### Support Templates

Create short templates for:

- “Project available now.”
- “Project recoverable and queued.”
- “We are checking legacy backup status.”
- “Project files not found.”
- “Legacy TimeTravel unavailable.”
- “Official statement for instructor/dean/professor.”

Tone: factual, accountable, no speculation, no blame-shifting.

## Phase 2: Rebuild Ground-Truth Inventories

All subsequent recovery should be driven by manifests, not by ad hoc UI checks.

### Inventory Inputs

Generate these durable files:

- All legacy projects from prod DB:
  - `project_id`
  - `created`
  - `last_edited`
  - `last_started` or closest available runtime/start field
  - `deleted`
  - legacy state
  - `disk_MB` or equivalent size metadata
  - collaborator account IDs
- Account activity summary:
  - `account_id`
  - `last_active`
  - whether account matches broad support-facing recovery predicate
- R2 project objects:
  - project ID
  - key
  - size
  - modified time
  - marker conflicts, if any
- GCS archive objects:
  - project ID
  - object name
  - size
  - updated time
  - generation
- GCS streams aggregate:
  - project ID
  - object count
  - total bytes
  - newest object timestamp
  - count of root `*.lz4`
  - count/size of `bup/`

### Streams Inventory

The previous streams listing session stopped before writing the full output. Rerun it as a durable job with logs and a checkpointable output strategy.

Requirements:

- Run under `nohup`, `systemd-run`, `tmux`, or GCP VM, not an ephemeral agent tool session.
- Write progress every N pages to a log file.
- Write incremental checkpoint shards, not only a final gzipped file.
- Include total pages, objects, matched objects, project count, and bytes.
- Do not download object contents; use the GCS JSON list API.
- Handle pagination retry safely.
- Preserve raw page cursor progress so the job can resume.

Recommended output:

```text
project_id<TAB>object_count<TAB>bytes<TAB>lz4_count<TAB>bup_object_count<TAB>newest_updated<TAB>newest_lz4_end
```

### Classification Join

After inventories are complete, compute these sets:

- `all_db_projects`
- `r2_available`
- `archive_available`
- `streams_available`
- `broad_active_definition`
- `broad_active_missing_r2`
- `broad_active_missing_r2_but_archive`
- `broad_active_missing_r2_but_streams`
- `broad_active_missing_all_sources`
- `last_1_month_missing_r2`
- `last_6_months_missing_r2`
- `last_1_year_missing_r2`
- `support_flagged_projects`

For every project missing all sources, classify evidence:

- Never started and zero disk size: likely dataless.
- Created and never opened: likely dataless.
- Had syncstrings, last_started, disk size, or other evidence of data: backup not found.
- Deleted project: separate class, do not mix with non-deleted user-visible projects.

Do not collapse “dataless” and “backup not found.” Users experience these very differently.

Deliverables:

- A reproducible script in `src/scripts/legacy-migration/` or scratch promoted into source.
- A versioned report with counts and sample IDs for each class.
- A CSV/TSV import into cocalc.ai DB or an admin-only lookup table for UI status.

## Phase 3: Design the Recovery Pipeline

The recovery target is the one-key R2 import contract:

```text
prod3/default/<project_id>.tar.zst
```

Every successful worker writes:

- final R2 `.tar.zst` via `.partial` upload and server-side promote
- recovery sidecar JSON with source, source generation/time, artifact size, method, worker version, and timestamp
- structured job log

Never mark a project done based only on “attempted.” Done means the final R2 object exists and passes the size/object predicate.

### Source Routes

Use routes in this order:

1. Already in R2:
   - Verify object exists and is not a pseudo-directory.
   - No conversion.
2. GCS archive tar exists:
   - Primary route: archive tar to R2.
   - Pilot both bup-based restore and lz4-based restore.
   - Prefer bup where it is valid and known co-temporal.
   - Fallback to lz4 reconstruction when bup is missing/stale/corrupt.
3. Streams prefix exists but archive tar missing:
   - Use streams `bup/` if valid and current.
   - Otherwise reconstruct from loose `*.lz4`.
4. No source:
   - Classify as dataless or backup-not-found based on DB evidence.

### Worker Requirements

The new worker can reuse kucalc code, but should be hardened for this new purpose:

- No dependency on old cluster state, old Kubernetes, or old DB standby.
- No dependence on historical cursor/worklist state.
- Input is an explicit project worklist with source route.
- Output is a final R2 object plus status sidecar.
- Per-project terminal states are explicit:
  - `done`
  - `already_available`
  - `no_source`
  - `dataless`
  - `bup_failed_lz4_done`
  - `bup_failed_lz4_failed`
  - `source_corrupt`
  - `worker_error_retryable`
- Chunk/worklist state is not terminal. Per-project result records are terminal.
- Use `.partial` upload and promote; never clobber a good object with a failed conversion.
- Delete stale `.skip`/`.old-no-bup` markers only after successful `.tar.zst` promote.
- Emit machine-readable JSONL result logs.
- Include source object generation or updated time so future audits can prove what was converted.

### Security

- R2 credentials come from Secret Manager or equivalent, not command-line args or job specs printed to logs.
- GCS source access should be read-only.
- Worker service account has only:
  - read access to source buckets
  - write access to logs/result bucket
  - no ability to delete source objects
- The control-plane account can submit jobs, but should not be embedded in workers.

## Phase 4: Pilot Before Scale

Run a pilot in the new GCP project before launching the large recovery.

Pilot selection:

- 10 recent missing-R2 projects with archive tars.
- 10 last-6-month missing-R2 projects with archive tars.
- 10 large archive tars.
- 10 tiny archive tars.
- Several archive tars with no bup.
- Several stream-only projects if the streams inventory finds them.
- Known support/project examples already investigated.
- A few projects that were already in R2 to test skip/idempotency.

Pilot checks:

- Worker can read GCS archive bucket from the new project.
- Worker can write R2 object and sidecar.
- `.partial` cleanup works after simulated failure.
- Archive route recovers expected file tree.
- Lz4 fallback works on at least one project.
- Sparse files stay sparse through tar/extract.
- Import into cocalc.ai works on sampled outputs.
- UI status changes from queued to available.
- Re-running the same worklist is idempotent.

Acceptance criteria:

- 100% of pilot projects end in a correct terminal state.
- No source bucket mutations.
- No secret leakage in logs.
- Cost and throughput estimates are measured, not guessed.

## Phase 5: Scale in GCP

Use the new project `migrate-cocalc-com-projects` for compute, preferably in `us-east1` because the archive bucket is in `us-east1`.

### Compute Shape

Start with GCP Batch or a managed worker pool. Batch is a good fit if:

- workers are stateless per shard
- logs go to Cloud Logging
- retries are per task
- service accounts and secrets are cleanly configured

Consider a custom managed instance group if:

- ZFS/lz4 fallback requires privileged setup that is awkward in Batch
- large scratch disks and long-running jobs are easier to manage on VMs
- resumability and local checkpointing are important

Recommended scaling sequence:

1. 100 projects.
2. 1,000 projects.
3. 10,000 projects.
4. One priority queue fully.
5. Full backlog.

Do not jump from pilot to 1.27M projects.

### Priority Queues

Process in this order:

1. Support-flagged project IDs.
2. Projects active in last 1 month and missing R2.
3. Projects active in last 6 months and missing R2.
4. Projects active in last 1 year and missing R2.
5. Broad active-definition projects missing R2 and present in archive.
6. Broad active-definition projects stream-only.
7. Older projects by request/on demand.

This gets users unstuck while the full backlog continues.

### Job Accounting

Maintain a durable job table or object ledger:

- `project_id`
- source route
- source bucket/key/generation
- queued_at
- started_at
- finished_at
- status
- artifact bytes
- error class
- retry count
- worker image/version/git commit

The migration UI should read from this status, not infer everything from slow bucket HEADs.

### Cost Controls

- Add GCP budget alerts before scale.
- Record GCS retrieval bytes and object operations.
- Prefer one pass over source data; avoid multiple full downloads.
- Batch by source route and rough size so whales do not starve small projects.
- Use spot/preemptible only after idempotency is proven.
- Keep R2 refresh hourly or on job completion; avoid expensive full listings for every UI request.

## Phase 6: Availability Refresh and UI Integration

The cocalc.ai DB/UI should not depend on live R2/GCS listings for every page load.

Implement or update a periodic importer that writes a project backup status table:

```text
project_id
r2_status
r2_size
r2_mtime
archive_status
archive_size
archive_updated
streams_status
streams_object_count
streams_bytes
classification
classification_updated
recovery_status
recovery_updated
evidence_version
```

Refresh triggers:

- hourly full/partial R2 listing
- hourly recovery-job result import
- less frequent GCS archive/streams inventory refresh
- manual admin refresh for a single project

UI restore buttons should be enabled from `r2_status`, not from stale imported `artifact_status='available'`.

## Phase 7: Blobs

Blobs are a separate recovery track and should not be ignored.

Tasks:

- Inventory old blob DB rows and old blob bucket objects.
- Determine which notebook/project files reference old blobs.
- Define scope:
  - active last 1 year
  - support-flagged
  - all migrated projects if feasible
- Copy required blobs to cocalc.ai storage or make legacy blob URLs resolvable.
- Add a user-facing status if blobs are missing from migrated notebooks.

Do not delete the old blob bucket.

## Phase 8: Communication Plan

### Public/User-Facing

Publish a concise migration status page:

- Project files are being recovered from legacy backups in phases.
- Some projects are available now.
- Some projects are queued for conversion from legacy archives.
- Some projects are still being checked.
- Legacy TimeTravel history is not recoverable.
- Users can file a support request to prioritize a specific project.

### Support Responses

Support should never say “maybe wait a month” unless there is a real queued recovery path.

Use precise responses:

- “This project is available now.”
- “This project is recoverable from a legacy archive and is queued.”
- “This project is not in R2 yet, but we found a legacy archive and can recover it.”
- “We have not found a backup source for this project. We are checking the final streams inventory.”
- “Legacy TimeTravel history is not recoverable.”

For TimeTravel:

- Take responsibility.
- State that it was not intended.
- State that the old TimeTravel data is irrevocably gone.
- Offer a written statement for academic/institutional processes.

### Internal

Create a daily migration report:

- R2 available count.
- Archive-pending count.
- Streams-pending count.
- No-source count.
- Dataless count.
- Jobs completed in last 24h.
- Failures by class.
- Top support-priority unresolved projects.
- Estimated time to finish current queue.

## Phase 9: Verification Gates

No claim of “done” without these gates.

### Per-Project Gate

A project is `available_now` only when:

- R2 final key exists.
- R2 object is not a pseudo-directory.
- Size is greater than the minimum structural threshold, or explicitly classified as tiny.
- If generated by recovery worker, sidecar exists and records source and method.

### Queue Gate

A queue is complete only when:

- Every project in that queue has a terminal per-project status.
- Terminal status is independent of worker chunk status.
- Retryable errors are either retried or escalated.
- The queue report includes counts and IDs for failures.

### Final Broad Recovery Gate

For each broad active-definition non-deleted project:

- R2 available, or
- recoverable source exists and queued/running, or
- no source found with evidence, or
- dataless with evidence.

This gate is broader than the old kucalc “qualified project” gate.

## Phase 10: Immediate Next 24 Hours

1. Make the UI/status text change plan concrete and implement it.
2. Rerun the GCS streams inventory in a durable way with checkpoints.
3. Freeze bucket lifecycle/IAM state and write the freeze report.
4. Build the joined status table from current DB/R2/archive inventories.
5. Identify support-priority missing projects and classify them by source route.
6. Do a small local/manual conversion test from one archive tar to R2 using the existing kucalc worker logic, but with new result logging.
7. Draft the user-facing migration status text and TimeTravel statement.
8. Decide Batch vs managed VM pool after one pilot conversion with real credentials.

## Phase 11: Immediate Code Tasks in cocalc-ai

Likely cocalc-ai changes:

- Add explicit legacy backup status fields/API results.
- Change legacy migration modal labels.
- Change “Not available yet” to source-specific statuses.
- Add admin status/evidence panel for a project.
- Add support-priority action: “queue recovery now” or “mark for recovery.”
- Ensure restore availability uses actual R2 status, not imported `artifact_status` alone.
- Add a clear TimeTravel notice to migration UI.

Do these before the full compute run if possible.

## Open Questions

- Exact schema/field for legacy `last_started` or the closest reliable “project ever started” signal in the imported cocalc.ai legacy tables.
- Whether the streams bucket contains most of the 151k broad-active projects missing both R2 and archive.
- Whether archive tar bup restore is sufficient for the 1.27M archive-backed projects, or whether a subset needs lz4 reconstruction for correctness.
- Best way to handle tiny-but-valid projects in the UI.
- Whether old blobs can be bulk restored cheaply enough for all migrated projects.
- Whether on-demand recovery from the migration UI should be exposed to users or kept admin/support-only initially.

## Working Principle

Assume nothing is done until there is a manifest, a reproducible script, and a terminal per-project status. The goal is not to defend the old shutdown plan; the goal is to recover everything still recoverable and explain the rest accurately.
