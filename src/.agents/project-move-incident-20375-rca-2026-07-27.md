# Project Move Incident 20375 RCA

Date: 2026-07-27

Status: recovery complete; preventive code implemented locally and awaiting
staging/prod rollout

Affected project: `165d0097-24ab-440c-a70e-4c7fb5199ff8`

Move: `asia-1` to `asia-3`, both in GCP region `asia-south2`, bay `bay-0`

Move operation: `9f2c5ae2-973f-44b4-8d44-08486c769cb1`

Support ticket: 20375

## Executive Summary

A project move stopped the source project and began a final backup. While that
backup was running, ordinary user traffic triggered project autostart. The
autostart restarted the project on the source host because placement had not
yet changed.

The final backup completed successfully. The move then changed placement to the
destination and requested an explicit restore of that backup. The restore start
encountered the recent global `running` state written by the source autostart.
The start path treated that state as evidence of a duplicate start and returned
success without contacting the destination project host or running Rustic.

The move's content sentinel correctly detected that the restore had not
happened and failed the move before source data cleanup. However, placement had
already changed to the empty destination. The user therefore saw a project with
apparently missing files even though both the source data and final backup
remained intact.

This was a lifecycle-coordination failure, not a storage, backup, Rustic,
network, region, or host-capacity failure.

## Impact

- One project is confirmed to have been affected by this exact sequence.
- The project appeared to have lost all files after the failed move.
- The user-visible disruption lasted approximately 72 minutes, from the failed
  destination cutover at about 13:39 UTC until the verified restore completed
  at 14:51 UTC.
- The user opened the support ticket at 14:05 UTC. Recovery completed 46
  minutes later, and support sent confirmation at 15:01 UTC.
- No project data was lost.
- The final pre-move backup and the source-host data were preserved.

The previous 30 days contain 80 move LRO attempts across 52 distinct projects.
Six distinct projects had a destination-verification failure under several code
versions. Those failures have different signatures and are not evidence that
all six projects experienced this exact data-visibility incident. They require
a separate retrospective review. Attempt counts include retries and
cancellations and must not be interpreted as a user-action success rate.

## Evidence

### Durable operation timeline

All times are UTC on 2026-07-27.

| Time         | Event                                 | Evidence                                                                                         |
| ------------ | ------------------------------------- | ------------------------------------------------------------------------------------------------ |
| 13:37:05.187 | Move requested                        | Move LRO `9f2c5ae2-973f-44b4-8d44-08486c769cb1` created                                          |
| 13:37:28.818 | Final backup requested                | Backup LRO `1ab949e4-882d-43e6-8533-924f12a67281` created                                        |
| 13:38:11.697 | Ordinary autostart requested          | Start LRO `7328e9a4-3c5e-4c74-93eb-801031bb8b2d`, input contains `autostart: true`               |
| 13:38:11.721 | Autostart admitted on source          | Runtime-slot audit event names host `246d760c-c160-46ee-a749-08a623f39d5e` (`asia-1`)            |
| 13:38:19.670 | Source autostart succeeded            | Runner timings show a real 4.6-second start and write global state `running`                     |
| 13:38:39.279 | Final backup snapshot created         | Backup ID `77018b800c91e63408f4bdbaf1bfcda3a2f81a43998bd85fd3bd41f432d088c2`                     |
| 13:38:45.569 | Final backup LRO succeeded            | Backup result persisted                                                                          |
| 13:38:46.954 | Destination restore start requested   | Start LRO `9a6fcdc6-8f29-4c48-9221-e112237cf233` contains the final backup ID                    |
| 13:38:46.972 | Restore start admitted on destination | Runtime-slot audit event names host `f071fdef-4c1d-4a02-9566-0e2aaa7f8c3a` (`asia-3`)            |
| 13:38:46.987 | Restore start reported success        | Completed in 33 ms, with only control timings and no runner or restore timings                   |
| 13:39:23.756 | Move failed verification              | Sentinel verification failed; destination placement was preserved and source cleanup did not run |
| 14:05:34     | User reported apparent data loss      | Zendesk ticket 20375                                                                             |
| 14:51:00.123 | Verified recovery restore requested   | Start LRO `277676d9-bd04-4abd-b89f-b615a76d8084`                                                 |
| 14:51:21.944 | Recovery restore succeeded            | Runner reports 14.5 seconds in `runner_start.restore_backup`                                     |
| 15:01:31     | Recovery confirmation sent            | Zendesk public response                                                                          |

### Backup and recovery verification

The final pre-move backup was:

- backup ID:
  `77018b800c91e63408f4bdbaf1bfcda3a2f81a43998bd85fd3bd41f432d088c2`
- 1,113 files
- 38,274,846 bytes
- 137 directories

Before recovery, an additional destination safety backup was created:

- backup ID:
  `31702c28444ba2263c3e5cb6e513d529ac73fac2f9e01b2ad79f164a74904974`
- tag: `incident-20375-pre-restore`
- parent: the final pre-move backup

After restoring the final pre-move backup:

- all 1,249 paths listed by Rustic for the archive existed on the destination;
- zero archived paths were missing;
- two additional notebook paths created or saved after the move remained;
- a direct project command read
  `Mandelbrot/mandelbrot.png` and returned `RECOVERY_OK`;
- the project started normally on `asia-3`.

### Rustic was not a factor

The Rustic command seen crashing during diagnosis was piped through `head`.
`head` closed stdout early and Rustic emitted a broken-pipe panic report. That
diagnostic panic did not occur in the move or restore path.

The incident backup completed successfully, was listed successfully, and was
restored successfully with every archived path present.

## Root Cause

Two independent correctness defects combined.

### 1. A project move did not fence ordinary starts

The move stopped the source before creating the final backup, but "stopped" was
not protected as an invariant. Autostart remained independently available for
the project for the entire move.

Because placement intentionally still pointed to the source during backup, an
autostart at that point correctly routed to the source host from the start
system's perspective, but violated the move state machine's assumptions.

The move and project-start systems each serialized their own work, but there
was no shared per-project exclusion mechanism between them.

### 2. An explicit restore was suppressed by stale global runtime state

`startProjectOnHost` evaluated the cached project state before reading
`restore_backup_id`. A recent `running` state caused an immediate successful
return.

That state described the source host. Placement had changed to the destination,
but the cached state did not include a host identity or placement generation.
The destination restore therefore inherited source-host runtime state and was
incorrectly classified as a duplicate start.

An explicit restore is an atomic data-replacement request, not merely a runtime
start. It must never be suppressed by cached `starting` or `running` state.

## Why the Existing Safeguards Did Not Prevent It

### Unified project-start LRO deduplication was too narrow

Commit `8a087883e7` made all active starts for a project use the same
`project-start` deduplication key. This prevents an autostart from superseding
an already-active restore.

In this incident, the autostart happened during the backup and completed 27
seconds before the restore start was created. No active start LRO remained to
deduplicate against. Start-to-start serialization cannot provide
move-to-start exclusion.

### The explicit-restore regression covered the wrong state

The existing test verified that a live destination project did not suppress an
explicit restore, but its database snapshot was `opened`. It did not exercise a
recent cached `running` snapshot, which returns before the live destination
probe.

### LRO success did not prove restore application

The destination child LRO treated a no-op return as success. Its result did not
include an applied backup ID or another durable restore receipt.

The 33-millisecond duration and absence of runner timings made the false success
visible retrospectively, but the parent move did not enforce those signals.

### The sentinel detected the problem after placement changed

The content sentinel worked as designed: it prevented successful completion
and source cleanup. It is a verification safeguard, not a placement
transaction. The user could still see the empty destination after the
verification failure.

## Contributing Factors

- Project runtime state is global metadata rather than host- or
  placement-generation-qualified state.
- The move's first source stop occurred before a backup that could take more
  than a minute; there was no final stop before placement changed.
- Active browser/project traffic can generate autostart without an explicit
  user click on Start.
- The move controller relied on several independently idempotent operations
  rather than owning one durable project-level lifecycle fence.
- Destination restore success was inferred from a child start's terminal
  status rather than a positive restore receipt.
- A failed move leaves a confusing user-visible state: destination placement is
  preserved for safety, but the UI does not explain that source data and backup
  are still safe.
- No dedicated operator alert or automated recovery workflow was triggered by
  the destination-verification failure; detection came from the support ticket.

## What Worked

- The source was not deleted after destination verification failed.
- The final backup completed and remained usable.
- The per-move sentinel detected that restored content was absent.
- The move error retained the destination-verification failure stage.
- The destination was backed up again before manual recovery.
- Durable LRO input and timing data made the race reconstructable.
- The admin support, database, host, backup, and project execution tools
  allowed recovery and independent verification without destructive guessing.

## Immediate Corrective Changes

The following changes are implemented locally and covered by focused tests.
They are not yet deployed at the time of this RCA.

### Durable move fence

- Acquire one row in `project_moves` before stopping or backing up the source.
- Identify the fence by the move LRO ID.
- Refresh it every 30 seconds.
- Expire it after five minutes without a heartbeat so a crashed move controller
  cannot block a project indefinitely.
- Release it in the move's `finally` path.
- Reject a second move while a non-expired fence exists.

### Authoritative start enforcement

- Check the move fence on the project's owning bay during start admission.
- Check it again immediately before actual start execution, closing the race
  between admission and execution.
- Reject manual starts and autostarts while another move owns the fence.
- Permit only the move's own destination restore to pass the matching move ID.
- Accept a move ID only when accompanied by the server-internal authorization
  symbol; strip caller-supplied IDs.

### Source quiescence

- Stop the source a second time after the final backup and before destination
  cleanup or placement mutation.
- This provides defense in depth against a start that entered execution just
  before the fence was acquired.

### Explicit restore semantics

- Read `restore_backup_id` before cached-state duplicate detection.
- Make every explicit restore bypass recent `starting` and `running` snapshot
  suppression.
- Continue probing and replacing an already-running destination when an
  explicit backup restore was requested.

### Expired authorization cleanup

- Permit source/destination backup access through `project_moves` only while
  the move fence is unexpired.
- Do not allow a stale crash row to grant former hosts continuing backup
  authority.

### Regression coverage

Focused tests now cover:

- ordinary start rejection during a move;
- internal move restore authorization;
- caller-supplied move ID rejection;
- guard acquisition, heartbeat, conflict, and release;
- a second source stop after backup;
- guard propagation by the move controller;
- explicit restore with a recent cached `running` state;
- active move backup authorization expiry.

The focused suite currently passes 87 tests across six suites.

## Rollout and Verification Plan

1. Deploy the hub/server change to staging.
2. Start a disposable project and generate continuous browser/file traffic that
   would normally trigger autostart.
3. Move it between two staging hosts while traffic continues.
4. Verify ordinary starts receive the temporary move-in-progress error.
5. Verify the final backup completes and the second source stop occurs.
6. Verify the destination child start reports a nontrivial
   `runner_start.restore_backup` duration.
7. Verify the exact requested backup ID is restored and the sentinel passes.
8. Verify the move fence is removed on success, failure, and cancellation.
9. Kill a staging move worker and verify the stale fence expires.
10. Run a second successful canary move without concurrent traffic.
11. Deploy to production and run one low-impact canary move.
12. Monitor all project-move and child-start LROs for at least 24 hours.

## Follow-up Actions

### P0: before broad production moves

- Deploy and validate the immediate corrective changes.
- Add an alert for any destination-verification failure.
- Add a monitor for a restore child LRO that succeeds without runner restore
  timings or in an implausibly short duration.
- Review the other five destination-verification failures from the last 30
  days and confirm each project's current data state.

### P1: remove inference from restore correctness

- Return a durable restore receipt from the project host containing the exact
  applied backup ID.
- Require the move parent to match that receipt to `finalBackupId` before
  placement is considered healthy.
- Include host ID or placement generation in project runtime-state snapshots.
- Ignore cached runtime state whenever it belongs to a previous placement.
- Surface a specific "project move in progress" state in the frontend instead
  of allowing generic reconnect/autostart behavior.
- Add an operator command that safely stops, waits for `opened`, restores an
  exact backup, and verifies the receipt.

### P2: establish move reliability as an operated feature

- Define a move success and recovery SLO based on distinct user move requests,
  not raw retry LROs.
- Build a dashboard for move stage duration, failure class, source cleanup, and
  restore receipts.
- Run a recurring end-to-end move test with concurrent browser traffic.
- Retain enough structured host lifecycle events to reconstruct starts, stops,
  backup application, and placement generation without relying on verbose
  journal tails.
- Document and automate recovery for every terminal move stage.

## Five Whys

1. **Why did the destination appear empty?**  
   The explicit backup restore never ran on the destination.

2. **Why did the restore not run even though its LRO succeeded?**  
   A recent cached `running` state caused the start path to return success
   before examining destination state or invoking the project host.

3. **Why was there a recent `running` state during a move?**  
   User traffic triggered autostart on the source while the final backup was
   running.

4. **Why could autostart run during a move?**  
   Project moves and project starts had separate serialization mechanisms and
   no shared project-level exclusion fence.

5. **Why did tests and monitoring not catch this before the user?**  
   Tests covered overlapping start LROs and live destination state, but not an
   autostart completed during backup followed by a stale source-host runtime
   snapshot. Monitoring tracked terminal LRO status but did not require a
   positive restore receipt or alert on destination verification failure.

## Final Classification

- Severity: high user impact for one confirmed project; no data loss
- Failure domain: project lifecycle control plane
- Primary cause: missing move/start exclusion invariant
- Secondary cause: host-agnostic cached state suppressing explicit restore
- Detection: customer support report
- Data durability: preserved by source retention, backup, and sentinel
- Recovery: exact backup restore plus path-by-path and runtime verification
