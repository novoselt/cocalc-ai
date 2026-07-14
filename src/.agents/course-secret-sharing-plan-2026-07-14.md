# Course Secret Sharing Implementation Plan

Date: 2026-07-14

Status: design plan; no implementation has started

Issue: https://github.com/sagemathinc/cocalc-ai/issues/188

## Summary

Add an explicit, auditable way for instructors to distribute selected project
secrets, such as dedicated OpenAI or Anthropic API keys, from the project that
contains a `.course` file into that course's student projects.

This feature must be designed as credential distribution, not ordinary course
configuration. Existing course configuration runs automatically in several
places, including when a `.course` file opens. Secret distribution must never
be added to those automatic paths.

The security model has three independent authorization gates:

1. The source secret is explicitly marked as eligible for course sharing.
2. An authenticated course manager creates a server-side sharing policy for
   this exact course identity in this exact source project.
3. Each destination student project is explicitly approved as a recipient.

No secret value, grant capability, or recipient authority is stored in the
`.course` file. The file contains only a random, non-authorizing `course_id`
used to bind UI state to server-side policy. Copying a `.course` file therefore
copies no authority.

Every operation that can broaden or perform distribution requires an explicit
user action and fresh authentication. Opening a course, reconfiguring course
projects, creating a student project, changing collaborators, or updating a
source secret must not distribute anything.

## Relationship To Existing Project Secrets

This plan extends, rather than replaces:

- `src/.agents/project-secrets-design-plan-2026-05-13.md`
- `src/.agents/project-secrets-audit-2026-05-13.md`
- `src/.agents/scalable-architecture.md`

The existing project-secrets guarantees remain in force:

- values are encrypted at rest in control-plane Postgres;
- values are never returned to browsers after storage;
- values are mounted read-only at runtime;
- filesystem backups, snapshots, downloads, public shares, and RootFS images
  do not include project secrets;
- any code or collaborator in a destination project can read its mounted
  secrets;
- cross-bay copies decrypt at the source and re-encrypt for the destination;
- plaintext must not be logged.

Course sharing adds authorization, provenance, recipient approval, and audit
state around the existing copy mechanics.

## General Project-Secret Live Runtime Refresh

Course sharing should not inherit the current requirement to restart every
student project after installing or rotating a secret. Besides being expensive
for a large course, that requirement is difficult to explain: the project
secret mutation succeeds immediately, but the mounted file remains stale until
an apparently unrelated project restart.

Implement live runtime refresh for project secrets generally before enabling
course distribution. This is a project-secrets capability, not course-specific
logic. Ordinary set, replace, delete, copy, generated SSH-key, and
course-managed mutations must all use the same host synchronization path.

This is also a deliberate advantage over environment variables. CoCalc exposes
secrets as files, so the host can change what future pathname reads return.
There is no reliable general mechanism for changing the inherited environment
of every already-running process.

### Current Runtime Path

The existing implementation already performs most of the required routing:

1. The owning bay commits a project-secret mutation in Postgres.
2. It builds a full encrypted runtime cache and sends it to the project's
   assigned host.
3. The project-host replaces its encrypted SQLite cache.
4. At project start, the project runner decrypts the cache, creates a private
   host directory under `/tmp/cocalc-project-secrets/<project_id>`, and bind
   mounts it read-only at `/run/secrets/cocalc`.

The missing operation is step 5: when the container is already running, update
the existing host directory after accepting the new encrypted cache.

A read-only bind mount prevents writes from inside the project container. It
does not prevent the trusted project-host from changing the bind mount's source
files. Those changes are visible to future pathname lookups in the running
container without changing Podman configuration.

### Required Semantics

- Setting or replacing a secret makes the new file contents visible to a
  running project without restarting the project.
- Deleting a secret removes its pathname from a running project without
  restarting the project.
- A stopped project only updates its encrypted host cache; its next start
  materializes the latest generation.
- A project that is starting or stopping is synchronized with the refresh so
  cleanup and materialization cannot race.
- Each individual secret file changes atomically. A reader sees either the old
  complete value or the new complete value, never a partial write.
- A process that already opened a deleted file may retain its open file
  descriptor, and an application that cached a value may retain that value.
  CoCalc guarantees live mounted-file refresh, not forced application reload.
- No project restart is automatically scheduled. An application-specific
  reload or restart may still be appropriate when that application reads its
  secret only once at startup.

### Ordered Cache Generations

The current full-cache payload has no project-level revision. Concurrent
mutations can build cache snapshots that arrive at the host out of order. This
is already a cache correctness risk and must be fixed before the cache directly
updates a running runtime.

Add an authoritative, monotonically increasing per-project secrets runtime
generation. A separate durable `project_secrets_runtime_state` row is cleaner
than deriving a generation from `MAX(updated_at)`, because deleting the final
secret must also advance the generation.

Suggested fields:

```sql
project_id UUID PRIMARY KEY REFERENCES projects(project_id) ON DELETE CASCADE,
generation BIGINT NOT NULL DEFAULT 0,
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
```

Rules:

- every transaction that changes a secret value or membership in the runtime
  set increments the generation exactly once;
- this includes set, replace, delete, import, generic copy, generated SSH keys,
  course-managed install/update/delete, and project clone initialization;
- metadata-only changes such as `allow_course_sharing` do not increment it;
- the owning bay reads the generation and complete encrypted entry set from one
  consistent database snapshot, so a cache payload cannot pair a new
  generation with old entries or the reverse;
- `ProjectSecretsRuntimeCache` carries the generation;
- project-host SQLite persists both the encrypted `cached_generation` and the
  last successfully applied `materialized_generation`;
- the host rejects an older generation and treats an equal generation as an
  idempotent cache replay, but still retries live materialization when
  `materialized_generation` is behind;
- the host returns cached generation, materialized generation, and runtime
  refresh outcome.

Update table ownership, hard-delete, backup/restore, and rehome handling for the
runtime-state row. It is authoritative on the same bay as the project.

### Live Materialization Algorithm

Do not reuse the startup helper's whole-directory replacement for a running
project. A bind mount remains attached to the directory inode that existed when
the container started; renaming a new directory over the host pathname does not
retarget that existing mount.

For an accepted cache generation:

1. Serialize refreshes with a per-project lock shared with project start,
   stop, runtime cleanup, and host-side SSH secret setup.
2. Validate and decrypt the complete cache in memory before modifying the live
   directory.
3. Commit the encrypted cache and `cached_generation` to project-host SQLite.
4. Determine the real local runtime state under the same lifecycle lock.
5. If the project is not running, return `cached_for_next_start`.
6. If it is running, verify that its secret bind mount points at the expected
   private host path. Fail closed on a mismatched or missing mount.
7. Create a private sibling staging directory, never a temporary file inside
   the mounted directory.
8. Write every new or changed value into staging with the existing private
   ownership and `0400` mode; flush and validate all files before publishing.
9. Atomically rename each staged file over its destination in the existing
   mounted directory.
10. Remove destination names absent from the new generation only after all
    additions and replacements have succeeded.
11. Persist `materialized_generation`, remove staging, and return
    `updated_live` with both generations equal.

This provides atomicity per secret file. A multi-secret refresh may have a very
short mixed-generation interval while individual renames complete. That is an
acceptable initial contract because secrets are independently addressed files;
document it and test that no partial file content is observable. If a future
consumer requires all files to switch as one snapshot, introduce a versioned
directory plus an atomically replaced in-mount indirection rather than trying
to replace the bind-mounted directory itself.

Never leave staging files or old plaintext generations visible in the mounted
directory. Cleanup must run on success, failure, project stop, startup failure,
and project-host startup garbage collection.

### Lifecycle And Failure Handling

The live refresh must be coordinated with the existing `starting` and
`stopping` states. Merely checking those sets without a shared lock leaves a
time-of-check/time-of-use race.

Use one per-project asynchronous lifecycle lock for:

- startup materialization and container launch;
- live secret refresh;
- stop and runtime-directory cleanup;
- generated SSH-key symlink setup where ordering matters.

The central Postgres mutation remains authoritative if host synchronization
fails. Do not roll back a successfully stored secret merely because a host is
temporarily unavailable. Instead:

- return a value-free runtime outcome such as `updated_live`,
  `cached_for_next_start`, `retry_pending`, or `stale_ignored`;
- record desired, cached, and materialized generations, never values or
  ciphertext;
- retain a retryable dirty/pending state for an assigned running project;
- retry on host reconnect/reconciliation and allow an explicit UI retry;
- always fetch the latest authoritative generation during retry rather than
  replaying a stale plaintext payload;
- use the next project start as the final fallback.

The current server path logs and suppresses host cache-sync failures. That is
not sufficient once the UI promises immediate visibility. Account-facing
mutation responses should include a safe runtime-refresh result, or a separate
status query must make it available. A successful central write with
`retry_pending` is still a successful secret mutation, but the UI must clearly
say that the running mount has not caught up yet.

Course sync results should record this runtime outcome per destination. A host
refresh failure must not be reported as a failed encrypted database install,
and it must not trigger a project restart fanout.

### Security Properties

Live refresh does not broaden the existing trust boundary: project-host already
decrypts and materializes every value at project start. Preserve these rules:

- plaintext exists only in project-host memory, the private staging area, and
  the private runtime mount source;
- staging and runtime paths remain outside project home, RootFS state, backup
  roots, snapshots, downloads, and public-share paths;
- no plaintext, ciphertext, or value-derived digest appears in RPC results,
  durable retry state, audit rows, errors, or logs;
- validate every secret name before path construction;
- use same-filesystem atomic renames and never follow project-controlled
  symlinks in the host runtime tree;
- verify permissions after replacement and fail closed if the runtime path or
  mount identity is unexpected;
- deletion removes new pathname access but cannot revoke a value already read
  by a process or collaborator.

### General UI Changes

- Remove the unconditional `Restart this project` warning after ordinary set,
  delete, and copy operations.
- Show a concise success state when the running mount was updated.
- Show a retryable warning only when runtime synchronization is pending or
  failed.
- Change generated SSH deploy-key setup to create the symlink and refresh the
  mounted private key without restarting the project.
- Remove `restart_required` from the SSH-key result contract, or replace it
  with the common runtime-refresh result.
- Explain that long-running applications may need to reload their own
  configuration after rotation, without implying that the whole CoCalc project
  must restart.

### Live Refresh Test Matrix

- a running container sees a newly added secret by pathname without restart;
- a running container sees an atomically replaced value without restart;
- a running container no longer sees a deleted secret by pathname;
- an already-open file descriptor has the documented Unix behavior;
- stopped projects return `cached_for_next_start` and start with the latest
  generation;
- out-of-order and duplicate cache deliveries cannot roll back host state;
- concurrent set/delete/copy operations converge to the authoritative latest
  generation;
- refresh racing start or stop cannot expose stale values, resurrect deleted
  files, or leave plaintext directories behind;
- no staging filename is visible from inside the container;
- permission, symlink, mount-identity, and malformed-name attacks fail closed;
- host disconnect produces `retry_pending`, then reconciliation applies only
  the newest generation;
- generated SSH deploy keys become usable without a project restart;
- representative logs, RPC responses, retry records, backups, snapshots, and
  RootFS publication contain no canary value;
- same-bay and cross-bay mutations produce identical refresh semantics.

## Goals

- Let an instructor explicitly select a small set of source-project secrets to
  share with student projects.
- Keep all values out of the `.course` file, SyncDB, browser state, project
  files, and course exports.
- Make copied/imported courses inert until explicitly authorized in their new
  project.
- Prevent a modified course roster from silently expanding the recipient set.
- Make every destination secret attributable to one course policy and one
  source secret.
- Allow safe updates of course-managed secrets without overwriting unrelated
  destination secrets.
- Support same-bay and cross-bay student projects.
- Make installed, updated, and removed secret files visible to running student
  projects without restarting those projects.
- Provide durable, value-free audit records for policy changes and sync runs.
- Make disabling, cleanup, rotation, conflicts, and partial failures visible.
- Fail closed when policy, identity, authorization, or project association is
  ambiguous.

## Non-Goals

- Do not hide a provider API key from students. Once copied into a student
  project, the student can read and exfiltrate it.
- Do not provide per-student provider credentials automatically.
- Do not proxy OpenAI, Anthropic, or other providers in the first version.
- Do not distribute secrets to shared or nbgrader projects in the first
  version. Only `course.type == "student"` is eligible.
- Do not support arbitrary source projects initially. The source project is
  exactly the project containing the `.course` file.
- Do not support destination aliases initially. Source and destination secret
  names are identical.
- Do not perform scheduled or background course distribution initially. This
  does not prohibit retrying a failed project-host runtime refresh for a secret
  already committed to one destination project.
- Do not restart student projects automatically after secret changes. Use the
  general live mounted-file refresh path, with application-specific reloads
  left to applications that cache values.
- Do not copy course-sharing eligibility or policies when cloning or copying
  projects or secrets.

## Current Behavior That Creates Risk

### Course Open Has Side Effects

`src/packages/frontend/course/sync.ts` calls
`actions.configuration.configure_all_projects()` after opening and loading the
course SyncDB.

`configure_all_projects()` can:

- create missing student projects;
- add or repair collaborators;
- update titles and descriptions;
- copy environment configuration;
- set course metadata;
- configure shared and nbgrader projects.

Therefore, neither `configure_all_projects()` nor any helper it invokes may
call a course-secret API. Add a regression test proving that opening and
ordinary reconfiguration perform zero secret-sharing mutations.

### Course Files Are Untrusted Configuration

A `.course` file may be:

- copied from another project;
- downloaded from GitHub;
- restored from a snapshot;
- edited directly;
- replaced at the same path;
- copied inside the same project;
- opened by a collaborator who did not create it.

Treat all settings and student records in the file as untrusted requests. They
must not function as credentials or grants.

### Project-ID Hashes Are Not Authorization

A hash of `project_id` is not a security boundary because project IDs are not
secret. A hash can detect some accidental movement but is forgeable and
copyable. Use a server-side policy bound to the actual project ID instead.

### Course Association Needs Hardening

The current `setCourseInfo` path checks collaborator access to the destination
project and, when present, the old course project. It does not clearly require
access to a newly assigned `course.project_id` for an initially unassociated
project.

Before relying on `projects.course` as one destination check:

- require the actor to be a collaborator on the destination project;
- require the actor to be a collaborator on the new course project;
- require a valid course type and normalized path;
- retain the current-course check when changing an existing association;
- keep internal `noCheck` access inaccessible from browser/account RPCs;
- add adversarial tests for claiming an unrelated course.

Even after this hardening, `projects.course` is necessary but not sufficient.
The recipient must also have an explicit server-side approval record.

## Threat Model

Protect against:

- opening a malicious imported `.course` file;
- a course file that names attacker-controlled student projects;
- replacing an authorized course file at the same path with a modified roster;
- copying an authorized `.course` file to another project or path;
- stale or forged `projects.course` metadata;
- accidental sharing of every source-project secret;
- a source secret becoming shareable due to migration defaults;
- overwriting a student's unrelated same-name secret;
- one course overwriting a secret managed by another course;
- a policy being revoked while a large sync is running;
- a source secret changing during a sync run;
- plaintext appearing in browser payloads, durable jobs, logs, errors, or audit
  records;
- cross-bay routing that bypasses either source or destination authorization;
- project rehome losing policy or managed-secret provenance;
- repeated requests causing duplicate or inconsistent writes.

This feature does not protect against a malicious collaborator on the source
project. Such a collaborator can already execute code and read mounted source
secrets. Fresh authentication and auditability still reduce accidental and
account-takeover risk.

## Security Invariants

The implementation is not complete unless all of these remain true:

1. Opening a `.course` file never copies, updates, or deletes a secret.
2. Generic course reconfiguration never copies, updates, or deletes a secret.
3. No existing secret is shareable after migration.
4. A copied course has no sharing authority in its destination project.
5. A `.course` file contains no secret value or usable authorization token.
6. A selected secret must still exist and be shareable at execution time.
7. A destination must be both approved and currently linked to the exact
   course project, course identity, and normalized course path.
8. New student projects receive no secret until explicitly approved.
9. Unmanaged destination secrets are never overwritten.
10. A managed destination secret is overwritten only by the same grant that
    created it.
11. Browsers receive names, metadata, previews, and status only, never values.
12. Durable queues and operation records contain no plaintext values.
13. Every policy, recipient, sync, cleanup, and failure is attributable to an
    account and timestamp without recording values.
14. Revocation prevents new writes immediately, including a run already in
    progress at its next bounded checkpoint.
15. Generic project clone and secret-copy operations do not copy course policy,
    shareability, recipient approval, or managed provenance.
16. Runtime cache generations never move backward, and updating the mounted
    files of a running project never requires a project restart.

## Course Identity

Add a random UUID `course_id` to the `.course` settings row.

Properties:

- generated once for a new course;
- not secret and not treated as a bearer token;
- used only as an identity component;
- bound server-side to `course_project_id` and normalized `course_path`;
- copied files retain the UUID but not the server-side binding;
- two files with the same UUID in one project are treated as an identity
  collision and require explicit reinitialization;
- moving or renaming an authorized course suspends sharing until an instructor
  explicitly rebinds the path with fresh authentication.

Legacy courses get a UUID when the sharing panel is first opened or when the
course is otherwise saved after this schema addition. Generating the UUID does
not enable sharing or create a policy.

The sharing configuration itself should not be stored in the `.course` file.
The panel loads it from the owning bay using `(course_project_id, course_id)`.

## Proposed Data Model

All schemas must be represented in the durable schema, migrations, table
ownership manifest, hard-delete cleanup, and project-rehome handling.

### `project_secrets` Additions

Add:

```sql
allow_course_sharing BOOLEAN NOT NULL DEFAULT FALSE,
revision BIGINT NOT NULL DEFAULT 1
```

Rules:

- replacing a secret value increments `revision` atomically;
- toggling `allow_course_sharing` does not increment the value revision;
- deleting the secret makes every associated grant ineligible;
- generic project-secret copy and project clone set
  `allow_course_sharing=FALSE` on the destination;
- generic copies do not copy managed provenance;
- metadata responses may expose the boolean and revision, but never values.

Use a dedicated mutation for the boolean so fresh-auth requirements cannot be
bypassed through the ordinary secret setter.

### `course_secret_policies`

Authoritative on the owning bay of the course/source project.

Suggested fields:

```sql
policy_id UUID PRIMARY KEY,
course_project_id UUID NOT NULL REFERENCES projects(project_id) ON DELETE CASCADE,
course_id UUID NOT NULL,
course_path TEXT NOT NULL,
enabled BOOLEAN NOT NULL DEFAULT FALSE,
generation BIGINT NOT NULL DEFAULT 1,
created_by UUID NOT NULL REFERENCES accounts(account_id),
updated_by UUID NOT NULL REFERENCES accounts(account_id),
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
revoked_at TIMESTAMPTZ,
UNIQUE (course_project_id, course_id)
```

`generation` increments for any policy, grant, recipient, path, or enabled-state
change. Sync runs pin a generation and stop if it changes.

### `course_secret_grants`

One row per explicitly selected source secret.

Suggested fields:

```sql
grant_id UUID PRIMARY KEY,
policy_id UUID NOT NULL REFERENCES course_secret_policies(policy_id) ON DELETE CASCADE,
source_secret_name TEXT NOT NULL,
enabled BOOLEAN NOT NULL DEFAULT TRUE,
created_by UUID NOT NULL REFERENCES accounts(account_id),
updated_by UUID NOT NULL REFERENCES accounts(account_id),
created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
revoked_at TIMESTAMPTZ,
UNIQUE (policy_id, source_secret_name)
```

Do not store encrypted or plaintext values in this table. Do not cascade-delete
audit history when a source secret is removed; mark the grant unavailable or
revoked while preserving history.

### `course_secret_recipients`

One row per explicitly approved student project.

Suggested fields:

```sql
policy_id UUID NOT NULL REFERENCES course_secret_policies(policy_id) ON DELETE CASCADE,
target_project_id UUID NOT NULL,
student_account_id UUID,
approved_by UUID NOT NULL REFERENCES accounts(account_id),
approved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
revoked_by UUID REFERENCES accounts(account_id),
revoked_at TIMESTAMPTZ,
PRIMARY KEY (policy_id, target_project_id)
```

The row is authoritative approval, not proof that the target is still valid.
Every execution also checks current project course metadata.

Store a nullable student account snapshot only for audit and UI context. Do not
use it instead of current destination validation.

### `project_secret_managed_sources`

Authoritative on the owning bay of each destination project. This records why a
target secret exists and controls safe overwrite/delete behavior.

Suggested fields:

```sql
project_id UUID NOT NULL,
name TEXT NOT NULL,
source_kind TEXT NOT NULL CHECK (source_kind = 'course'),
source_project_id UUID NOT NULL,
source_course_id UUID NOT NULL,
source_policy_id UUID NOT NULL,
source_grant_id UUID NOT NULL,
source_secret_name TEXT NOT NULL,
source_secret_revision BIGINT NOT NULL,
installed_by UUID NOT NULL REFERENCES accounts(account_id),
installed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
PRIMARY KEY (project_id, name),
FOREIGN KEY (project_id, name)
  REFERENCES project_secrets(project_id, name) ON DELETE CASCADE
```

The source project and policy may live on another bay, so do not add local
foreign keys to those remote rows.

Ordinary set/delete operations on a managed secret must not silently destroy
or retain inconsistent provenance. Initial behavior should reject ordinary
mutation with a clear `managed_by_course` error. A later explicit detach/opt-out
workflow can be designed separately.

### Sync Runs And Results

Add durable, value-free operation records on the policy's owning bay:

```text
course_secret_sync_runs
  run_id
  policy_id
  policy_generation
  actor_account_id
  status
  requested_secret_names
  requested_target_count
  copied_count
  unchanged_count
  conflict_count
  skipped_count
  failed_count
  created_at
  started_at
  finished_at
  error_code

course_secret_sync_results
  run_id
  target_project_id
  secret_name
  source_revision
  status
  error_code
  created_at
  updated_at
```

These tables must never contain plaintext, ciphertext, provider responses, or
arbitrary exception strings that could include values. Use bounded enumerated
error codes and separately sanitized diagnostic text only when necessary.

## Authorization Model

### Who May Manage Sharing

Require:

- signed-in account;
- collaborator or owner on the course/source project;
- fresh browser authentication;
- exact course identity and path binding.

This matches the existing project-secret boundary: a source-project
collaborator can already read the secret from the runtime. Owner-only sharing
would add friction without preventing a malicious source collaborator from
obtaining the value. Record the actor for every mutation.

### Fresh Authentication

Fresh auth is required for:

- enabling or disabling `allow_course_sharing`;
- creating, changing, rebinding, enabling, or revoking a policy;
- adding or removing grants;
- approving or revoking recipients;
- executing a sync;
- deleting managed destination copies through a course cleanup operation.

Add every mutation to `dangerous-rpc-registry.ts` with an explicit
`fresh-auth-required` decision. Wire all browser actions through
`useFreshAuthAction` and pass browser/session context.

Read-only metadata, previews, status, and audit history do not require fresh
auth but still require course-project collaborator access.

### Source Restriction

For version one:

```text
source_project_id == course_project_id
```

Do not expose a source-project picker. This substantially simplifies ownership,
authorization, UI explanation, and copied-course behavior.

### Destination Validation

At preview and again at execution, require all of:

- destination exists and is not hard-deleted;
- recipient approval is active for this policy;
- `projects.course.type == "student"`;
- `projects.course.project_id == course_project_id`;
- normalized `projects.course.path == policy.course_path`;
- destination is not in a rehome/move fence that forbids mutation;
- destination owning bay and epoch resolve successfully;
- destination secret count will remain within the product cap.

Never provide an endpoint where a student project can claim a policy merely by
presenting `course_id` or setting its own course metadata.

## API Shape

Add a dedicated course-secret API. Do not implement this as a frontend loop
over `copyProjectSecrets`.

Suggested account-facing methods:

```ts
listCourseShareableSecrets({ course_project_id });
getCourseSecretPolicy({ course_project_id, course_id, course_path });
previewCourseSecretSync({
  course_project_id,
  course_id,
  course_path,
  target_project_ids,
});
setProjectSecretCourseSharing({
  project_id,
  name,
  allow,
  browser_id,
  session_hash,
});
setCourseSecretGrants({
  course_project_id,
  course_id,
  course_path,
  names,
  browser_id,
  session_hash,
});
approveCourseSecretRecipients({
  course_project_id,
  course_id,
  course_path,
  target_project_ids,
  browser_id,
  session_hash,
});
revokeCourseSecretRecipients({
  course_project_id,
  course_id,
  target_project_ids,
  browser_id,
  session_hash,
});
startCourseSecretSync({
  course_project_id,
  course_id,
  course_path,
  browser_id,
  session_hash,
});
getCourseSecretSyncStatus({ course_project_id, course_id, run_id });
revokeCourseSecretPolicy({
  course_project_id,
  course_id,
  remove_managed_copies,
  browser_id,
  session_hash,
});
```

The exact names may change to match nearby APIs, but the trust boundaries must
not be collapsed.

Responses include only:

- secret names and metadata;
- policy/grant/recipient identifiers;
- project identifiers and safe project/student labels;
- validation and conflict status;
- revision numbers;
- aggregate and per-target result codes;
- runtime-refresh outcomes and generations.

No account-facing response returns a source or destination value.

## Server-Side Sync Algorithm

Use the course/source owning bay as coordinator.

1. Authenticate the account and require fresh auth.
2. Resolve the course project owning bay and route there.
3. Load the policy and verify project, UUID, normalized path, enabled state,
   generation, and actor access.
4. Load enabled grants.
5. For each grant, require the source secret to exist and still have
   `allow_course_sharing=TRUE`.
6. Pin each source secret revision for the run.
7. Load active approved recipients.
8. Revalidate every destination's current course association and ownership.
9. Create a durable sync run containing identifiers and revisions only.
10. Process targets with conservative bounded concurrency.
11. For each target, decrypt source values only in memory and send them through
    the authenticated inter-bay project-secrets service when needed.
12. The target bay revalidates destination course association, move/rehome
    fences, secret limits, and provenance conflicts.
13. In one target-bay transaction, encrypt for the target project, write or
    update `project_secrets`, and write managed provenance.
14. Refresh the destination host's encrypted secrets cache and, when the
    project is running, atomically refresh the mounted secret files through the
    general live runtime path.
15. Record a value-free result and publish project secret metadata
    invalidation.
16. Between bounded batches, recheck policy generation and enabled state.
17. If policy generation or a source revision changed, stop with `stale_policy`
    or `stale_source_revision`; do not mix revisions silently.
18. Complete the run with aggregate counts and value-free runtime-refresh
    status, including any destinations pending host retry.

Plaintext values must never be persisted in the durable run. If a worker
restarts, it revalidates and decrypts the pinned current revision again. If the
revision no longer matches, it stops and requires a new run.

### Idempotency

- `run_id + target_project_id + secret_name` is the operation identity.
- Replaying a completed result is a no-op.
- Replaying a partial same-grant write may update only when source revision and
  policy generation still match.
- Client retries must not create duplicate recipient approvals or grant rows.

### Conflict Rules

For target secret name `N`:

- no existing secret: create it and provenance;
- existing secret managed by this exact grant: update it;
- existing secret managed by another grant/policy: conflict;
- existing secret without managed provenance: conflict;
- existing inconsistent provenance: fail closed and emit an audit finding.

Do not offer `overwrite anything` in the course UI.

## Multi-Bay And Rehome Requirements

Ownership:

- source `project_secrets` and `project_secrets_runtime_state`: source project
  owning bay;
- course policies, grants, recipients, and sync runs: course project owning bay;
- destination `project_secrets` and managed provenance: destination project
  owning bay.

The browser talks to its home bay. The course-secret API resolves and routes to
the course owning bay. The source bay coordinates target calls through the
inter-bay service; browsers never relay values.

Add narrow internal methods for installing/removing course-managed secrets.
They must accept only authenticated inter-bay calls and must independently
validate the destination project association. Do not expose raw
`importProjectSecretsForCopy` semantics as a course capability.

Project rehome handling must include:

- policies/grants/recipients/runs when the course project moves;
- managed provenance when a student project moves;
- encrypted secret decrypt/re-encrypt and cache invalidation already required
  for `project_secrets`;
- fencing so no sync writes during an ownership epoch transition;
- stale-epoch retry that reroutes instead of writing to the old bay.

Update `table-ownership.ts`, rehome side-table handling, hard-delete cleanup,
backup/restore manifests, and ownership consistency tests.

## UI Plan

### Project Secrets Settings

For each secret row, add an `Allow sharing with courses` control.

Behavior:

- off by default;
- fresh-auth protected;
- warning explains that this only makes the secret eligible and does not share
  it yet;
- show which local courses currently have grants for it;
- disabling immediately blocks future syncs;
- disabling does not silently delete existing student copies;
- offer a link to review affected course policies and perform explicit cleanup.

### Course Configuration Panel

Add a `Shared Secrets` card, initially showing:

```text
No secrets are shared with student projects.
```

The card shows:

- course identity/binding status;
- eligible source secret names only;
- selected grants;
- approved recipient count;
- new/unapproved student project count;
- conflicts and invalid course associations;
- last sync actor, time, and summary;
- live-updated, next-start, and retry-pending counts;
- disabled/revoked state.

Actions:

- `Select secrets...`
- `Review recipients...`
- `Review and share now...`
- `Update shared secrets...`
- `Stop sharing...`
- `Remove managed copies...`

Do not place any secret-sharing action in the generic `Reconfigure all
projects` card.

### Confirmation UX

Before distribution, show a fresh-auth confirmation with concrete scope:

```text
Share 2 secrets with 31 approved student projects

Secrets:
- OPENAI_API_KEY
- ANTHROPIC_API_KEY

New recipients requiring approval: 3
Existing approved recipients: 28
Conflicts: 1
```

For large courses, provide a searchable/scrollable complete recipient list.
Do not hide new recipients behind only an aggregate count.

Required warning:

> Every student, collaborator, and program in these projects can read these
> credentials. This distributes the provider keys; it does not hide them from
> students. Use dedicated course keys with provider-side spending and usage
> limits.

The execute button remains disabled until new recipients are explicitly
selected/approved and conflicts are acknowledged.

### New Student Projects

Creating or configuring a new student project does not copy secrets. The
course panel displays it as `Pending secret approval`. An instructor returns to
the panel, reviews new recipients, and explicitly shares.

## Update, Disable, Cleanup, And Rotation Semantics

### Source Value Update

Replacing a source secret increments its revision but does not push it. The
source project's own running mount refreshes normally, but no student copy is
changed. The course panel shows that approved projects are out of date. An
instructor runs an explicit update.

### Disable Source Eligibility

Turning off `allow_course_sharing` blocks every new sync immediately. Existing
target copies remain until explicit cleanup. Show affected courses and provide
cleanup actions.

### Revoke A Grant Or Policy

Revocation increments policy generation and stops active runs at the next
checkpoint. The instructor chooses whether to:

- stop future synchronization only; or
- also delete destination secrets still managed by this grant/policy.

Cleanup deletes only rows whose managed provenance exactly matches the revoked
grant. It does not delete conflicts, detached secrets, or unrelated same-name
secrets.

### Irreversibility Warning

Removing a destination copy cannot make a student forget or delete a value
they already read. The UI must recommend:

1. stop/revoke sharing;
2. remove managed copies;
3. rotate or revoke the key at the provider;
4. store the replacement as a new revision;
5. explicitly redistribute it.

## Audit And Logging

Record durable events for:

- source secret course-sharing enabled/disabled;
- policy created/rebound/enabled/revoked;
- grant added/removed;
- recipient approved/revoked;
- sync started/completed/failed/stopped stale;
- destination created/updated/conflicted/skipped;
- cleanup started/completed/failed;
- runtime cache or live mount refresh completed/pending/failed.

Each event includes relevant IDs, actor, source revision, policy generation,
counts, and timestamps. No event includes plaintext or ciphertext.

Logging rules:

- structured logs may contain secret names but never values;
- do not log request objects containing value maps;
- redact inter-bay payloads;
- sanitize caught errors before persistence;
- never include provider keys in conflict or validation messages;
- tests must capture representative logs and assert the fixture values are
  absent.

## Limits And Abuse Controls

Initial conservative limits:

- at most 20 enabled grants per course policy;
- at most 1,000 approved recipients per policy;
- at most 20,000 target-secret writes per run;
- bounded target concurrency, initially 5;
- one active sync or cleanup run per policy;
- ordinary project-secret count and value-size caps still apply;
- rate-limit repeated preview and mutation calls per account/policy.

Reject over-limit requests before decrypting any value.

## Test Plan

### Schema And Migration Tests

- existing secrets migrate with `allow_course_sharing=FALSE`;
- existing secrets get a stable initial revision;
- runtime-state generations advance on every value-set change, including
  deletion of the final secret;
- policy tables enforce uniqueness and foreign keys;
- provenance cannot exist without a destination secret;
- all durable tables appear in table ownership and hard-delete manifests;
- course and student project rehome fixtures include the correct side tables.

### Authorization Tests

- anonymous account rejected;
- non-collaborator on course project rejected;
- stale fresh auth rejected for every mutation;
- collaborator with fresh auth accepted;
- initial course association to an inaccessible course project rejected;
- changing an existing association without old-course access rejected;
- internal bypass unavailable through account-facing RPC;
- student cannot claim a policy using `course_id` or course metadata;
- copied course in another project has no policy authority;
- path mismatch and duplicate course identity fail closed.

### No-Automatic-Propagation Tests

- opening a course invokes no course-secret mutation;
- `configure_all_projects()` invokes no course-secret mutation;
- creating a student project invokes no course-secret mutation;
- collaborator repair invokes no course-secret mutation;
- source secret update invokes no course-secret mutation;
- course configuration copy/export does not copy policy or grants.

### Source Tests

- unshareable secret cannot be granted or synced;
- deleted source secret blocks sync;
- source revision increments on value replacement;
- source revision change during run stops stale work;
- generic secret copy/clone resets sharing eligibility;
- no API response exposes source values.

### Recipient Tests

- unapproved destination rejected;
- approved destination with wrong project/course/path/type rejected;
- newly added student remains pending;
- revoked recipient rejected immediately;
- unmanaged same-name secret is preserved and reported as conflict;
- other-course managed secret is preserved and reported as conflict;
- same-grant managed secret updates successfully;
- secret-count cap failure does not leave partial target state;
- generic set/delete of a managed secret fails clearly.

### Sync And Concurrency Tests

- same-bay copy decrypts/re-encrypts for destination metadata;
- cross-bay copy routes by both owning bays and epochs;
- browser never receives plaintext;
- target transaction writes secret and provenance atomically;
- replay is idempotent;
- partial run resumes without duplicate writes;
- revocation during a run stops after a bounded checkpoint;
- project rehome fence prevents writes to stale ownership;
- target cache refresh and invalidation occur after successful writes;
- running targets see installed and updated files without a project restart;
- out-of-order target cache delivery cannot roll back the accepted generation;
- one target failure does not hide successful/failed per-target results;
- durable run records survive coordinator restart without stored plaintext.

### Revocation And Cleanup Tests

- disabling eligibility blocks future sync;
- policy revocation increments generation;
- cleanup removes only exact managed provenance matches;
- cleanup does not remove unmanaged or other-policy secrets;
- cleanup works after destination is no longer course-linked;
- cache invalidation and live mount removal run after deletion;
- runtime refresh pending/failure status is reported without scheduling a
  project restart.

### Leak Tests

Use recognizable canary values and assert they do not appear in:

- `.course` SyncDB rows;
- browser RPC responses;
- serialized Redux state;
- source and destination logs;
- Conat tracing/debug output;
- sync-run and audit tables;
- thrown error messages;
- project files, snapshots, backups, downloads, public shares, or RootFS output.

### Manual Adversarial Scenarios

1. Put a malicious `.course` file from GitHub in a project containing eligible
   secrets and open it. Verify no values move and no policy is created.
2. Copy an authorized course file to another project and path. Verify the panel
   is unconfigured.
3. Replace an authorized course file at the same path with a roster containing
   a new attacker-controlled project. Verify it is pending and receives
   nothing without explicit approval.
4. Attempt to link an unrelated project to the course through direct API use.
   Verify rejection.
5. Create a target-local same-name secret. Verify course sync reports conflict
   and preserves it.
6. Start a large sync, then revoke the policy. Verify bounded termination and
   accurate partial results.
7. Rotate a source key and sync explicitly. Verify a running student project
   sees the new complete value without restart while the browser and logs never
   saw it.

## Implementation Phases

### Phase 0: Security Prerequisites

- implement and audit the general ordered project-secret live runtime refresh,
  including lifecycle locking, retry status, and the live refresh test matrix;
- harden `setCourseInfo` for new course associations;
- add canonical course-path normalization shared by frontend and backend;
- add `course_id` initialization and duplicate-identity handling;
- add regression tests proving course open/reconfigure do not share secrets;
- document the threat model and invariants in code near the new API.

Do not proceed to value transfer until this phase is reviewed.

### Phase 1: Source Eligibility And Schema

- add `allow_course_sharing` and `revision` to `project_secrets`;
- add fresh-auth-protected eligibility mutation;
- add policy, grant, recipient, run, result, and provenance schemas;
- update table ownership, hard delete, backup, and rehome manifests;
- ensure clone/copy defaults remain non-shareable and unmanaged;
- add migration and ownership tests.

### Phase 2: Policy And Preview APIs

- implement policy/grant/recipient CRUD on the course owning bay;
- implement read-only preview with exact destination validation;
- add dangerous-RPC decisions and fresh-auth wiring;
- add value-free audit events;
- expose no transfer operation yet;
- security-review this boundary before Phase 3.

### Phase 3: Managed Same-Bay Transfer

- implement same-bay coordinator and target transaction;
- add managed provenance and collision rules;
- add durable run/results without plaintext;
- add ordered cache and live mounted-file refresh with retry-pending reporting;
- complete unit, integration, replay, and leak tests.

### Phase 4: Cross-Bay Transfer And Rehome

- add narrow authenticated inter-bay install/remove methods;
- route by source and destination ownership/epoch;
- add stale-epoch and rehome fencing;
- extend project move/rehome handling for every new table;
- test source and targets on different bays.

### Phase 5: Course And Project UI

- add the source secret eligibility control;
- add the initially empty course configuration card;
- add policy, grant, recipient, preview, sync, status, and cleanup UI;
- require fresh auth for every mutation;
- show complete recipient scope and extraction warning;
- keep all secret actions separate from ordinary reconfiguration.

### Phase 6: Security Audit And Rollout

- run the full adversarial and leak test matrix;
- review every log statement and error boundary touched by values;
- review dangerous-RPC registry coverage;
- review table ownership and cross-bay routing;
- verify copied/imported courses are inert;
- perform manual same-bay and cross-bay tests with canary keys;
- write a dated security-audit document under `src/.agents`;
- ship behind a site feature flag, default off;
- enable on a test site first;
- monitor failures and audit events before production enablement.

## Acceptance Criteria

The feature is ready only when:

- an instructor can explicitly share selected eligible secrets with approved
  student projects without ever seeing/copying their values;
- existing installations start with zero eligible secrets and zero policies;
- opening, importing, copying, or reconfiguring a course cannot distribute a
  secret;
- new recipients always require explicit approval;
- destination association is checked at execution, not trusted from the file;
- unmanaged destination values are never overwritten;
- copied values retain managed provenance and can be updated or cleaned safely;
- all mutation paths require fresh authentication and durable audit records;
- same-bay, cross-bay, live refresh, next-start fallback, retry, partial
  failure, revocation, and rehome behavior are tested;
- running student projects receive added, rotated, and removed mounted secret
  files without project restarts;
- canary values are absent from files, browser state, logs, durable jobs, and
  audit records;
- the UI plainly states that students can read distributed provider keys and
  recommends dedicated limited course credentials.

## Deferred Safer Provider Model

For OpenAI and Anthropic specifically, a future credential-broker/proxy model
could issue per-student CoCalc tokens, enforce budgets, attribute usage, and
keep the provider master key out of student projects. That is a materially
stronger product but requires provider-protocol proxying, streaming support,
accounting, and abuse controls.

The explicit distribution model in this plan remains worthwhile now because it
is substantially safer than putting keys in project files, where they enter
snapshots, backups, downloads, and shares. The UI must never imply that copied
keys are hidden from students.
