# Legacy Public File Shares Migration Plan

Date: 2026-07-15

## Status: Proposed

This plan restores direct file publication on `cocalc.ai` and replays retained
legacy `public_paths` records without broadening access from a single file to
its parent directory.

The first production canary is legacy project
`de962cab-0056-45d1-9984-fd2b2fcca64c`, including these historical public path
identifiers:

- `0a48957b67f375b9e3107216504ca0c4efb678fd`
- `5ae5d2b24d01346592709438d39eece22e4a339a`
- `e380e367dbbde05a4627b246b412bc5877b3958c`

One cited URL is:

```text
https://share.cocalc.com/share/0a48957b67f375b9e3107216504ca0c4efb678fd/admcycles%20tutorial.ipynb?viewer=share
```

## Problem

The current public-share implementation supports directory shares. During
legacy project restoration, directory-scoped `public_paths` records are
replayed, but file-scoped records are deliberately disabled. Replaying a file
as its containing directory would expose sibling files that were never public.

The project files and raw legacy `public_paths` data are retained. Existing
host redirects also preserve the historical identifier and filename. The
missing component is an exact-file share model and resolver.

This is a durable-link migration defect. Some affected links appear in
published papers, course pages, and other external material that users cannot
realistically update everywhere.

## Decisions

- Add first-class direct file shares.
- Continue using live restored project files as the source of truth.
- Do not restore the old share server or duplicate files into a publication
  store.
- Keep the current sign-in requirement for the first release. Anonymous static
  publication is a separate product and abuse-control decision.
- Preserve each legacy `public_paths.id` as a permanent compatibility alias.
- Keep a separate canonical slug so owners can use readable modern URLs.
- Keep Cloudflare redirects generic and path-preserving. Database-backed share
  resolution belongs in the application.
- Treat the project-owning bay as authoritative for share metadata and file
  access. Use the existing global/seed slug-directory routing rather than
  probing or directly querying another bay's project database.

## Goals

- Publish exactly one regular project file without exposing its parent.
- View, download, and copy a directly shared file.
- Create a ready-to-run project using the source project's RootFS configuration.
- Preserve historical SHA-1 share identifiers and old URL shapes.
- Replay all retained file-scoped `public_paths`, not only reported examples.
- Resolve retained-but-unavailable shares to a useful explanation instead of a
  generic not-found page.
- Make import and replay safe to retry and resume.

## Non-Goals

- Anonymous project filesystem access in the first release.
- Reintroducing server-side notebook rendering.
- Reintroducing the legacy Jupyter execution API.
- Publishing arbitrary symlinks before target containment is proven safe.
- Duplicating project data into R2 or another public-content store.
- Making viewers project collaborators.

## Data Model

### Share path type

Add a required `path_type` to `public_project_paths`:

```text
directory
file
```

Existing rows migrate to `directory`. New rows must explicitly store their
type. Add a database constraint so unknown values cannot be written.

Expose `path_type` through all public-share API summaries, resolved shares,
temporary viewer grants, labels, admin views, and migration reports.

### Canonical slugs and aliases

Keep `public_project_paths.slug` as the canonical modern slug. Extend
`public_project_path_slugs` into an alias registry with an alias kind such as:

```text
canonical
legacy-public-path
retired-canonical
```

A canonical slug rename may replace or retain the canonical entry according to
normal product policy, but it must never delete a `legacy-public-path` alias.

For each migrated row, register `public_paths.id` as a permanent alias pointing
to the imported share. Alias registration must use the same global uniqueness
and owning-bay routing rules as canonical slugs.

## Exact-File Security Model

Directory shares currently include both the directory and `directory/**`.
File shares must generate only one include rule for the exact normalized file
path. They must not include `path/**` and must not include the parent.

All authorization remains enforced by the project-host file service. UI hiding
is not a security boundary.

For the first release:

- require the target to be a regular file;
- reject symlinks;
- reject `.snapshots`, `.backups`, `.ssh`, `.cache`, `.local`, and existing
  protected paths;
- normalize and validate paths before policy construction;
- deny parent listing, sibling stat/read/download, and traversal;
- use the same exact policy for viewing, direct download, copying, and LRO
  source access.

If symlink support is added later, resolve the target server-side and prove it
remains within an allowed publication scope before granting access.

## Backend Operations

Update the public-share service so each operation understands `path_type`:

- `create` stats the selected path and records `file` or `directory`;
- `resolve` returns the type and the correct read policy;
- `grantTemporaryViewerAccess` stores the exact policy;
- `authorizeRead` returns the exact policy to the project host;
- direct file downloads use the exact shared path;
- `listDirectory` is unavailable for a file share;
- `copyToProject` copies the exact file;
- `copyToNewProject` creates a compatible project and copies the file using its
  basename;
- disabling a share revokes canonical and alias resolution without deleting
  either reservation;
- availability checks distinguish missing project, unrestored project, missing
  path, wrong path type, and archived/offline state.

Continue copying the source project's RootFS image configuration into a new
project. Host and region affinity should remain best-effort as in directory
share copying.

## URL Resolution

Support all of these forms:

```text
/share/<canonical-slug>
/share/<legacy-public-path-id>
/share/<legacy-public-path-id>/<historical-filename>
/share/public_paths/<legacy-public-path-id>
```

The existing longest-slug-first route candidate logic remains useful. Once a
file share resolves:

- an empty suffix opens the file;
- a suffix exactly equal to the published basename is accepted for legacy
  compatibility;
- any other suffix is rejected;
- an accepted historical form redirects to the canonical share URL after
  preserving relevant query parameters.

Do not let a file-share suffix become a relative path below the file.

## Frontend

### Publishing

The file explorer's Publish action should support both files and directories.
The dialog should state clearly what is being exposed:

```text
Publish this file
Publish this folder and its contents
```

The project Settings publication page can remain directory-oriented initially,
but its list and account-wide Public Shares page must display the path type.

### Viewing

A file share opens directly in the normal read-only viewer for its type. It
does not show a parent-directory browser. It may offer:

- Download;
- Copy to Project;
- Create Ready-to-Run Project;
- owner/admin metadata and disable actions where authorized.

Notebook, markdown, text, PDF, image, and other supported viewers should reuse
the normal frame-editor path rather than custom share-only renderers.

## Legacy Import and Replay

### Retained raw records

The raw import already preserves fields including:

- `id`;
- `project_id`;
- `path`;
- `original_path`;
- `original_path_type`;
- `url`;
- visibility and descriptive metadata.

Some existing imported file rows store the containing directory in `path` and
the exact file in `original_path`. Replay must use `original_path` whenever
`original_path_type='file'`.

The current extension-based classification is only a hint. Prefer, in order:

1. an authoritative restored-filesystem stat;
2. archive manifest type information;
3. retained `original_path_type`;
4. the filename heuristic only when no stronger information exists.

Ambiguous records should remain pending and appear in the report rather than
being published as directories.

### Idempotent replay

Replace the current file-share disabling branch with an exact-file upsert.
Key replay identity is `legacy_public_path_id`, not slug or path.

On every replay:

- resolve the restored project mapping;
- recover the exact original file path;
- create or update one share row;
- set `path_type='file'`;
- restore the legacy visibility state;
- register the legacy ID alias;
- retain the canonical slug and descriptive metadata;
- set an explicit availability status;
- re-enable rows previously disabled only because file sharing was unsupported;
- leave user-disabled or historically disabled rows disabled.

The replay must be safe under retries, concurrent project restoration, and
partial failures.

### Backfill command

Provide dry-run and apply modes with:

- `--legacy-project-id`;
- `--legacy-public-path-id`;
- account/owner filtering;
- `--limit`;
- checkpoint/resume support;
- bounded concurrency;
- machine-readable JSON report output.

Report totals for imported, updated, unchanged, pending, missing project,
missing file, wrong type, disabled, alias collision, and failed records.

## Cloudflare Redirects

Use generic path-preserving redirects, initially with HTTP 302:

```text
share.cocalc.com/* -> https://cocalc.ai/<same-path-and-query>
cocalc.com/share/* -> https://cocalc.ai/share/<same-suffix-and-query>
```

Avoid per-share rules and avoid embedding database mappings at the edge. Test
spaces, Unicode, percent encoding, and query preservation so paths are not
double encoded.

Change stable rules to 308 only after the complete replay report and sampled
historical URLs pass.

## Testing

### Unit and service tests

- file policy permits the exact path;
- file policy denies parent and sibling paths;
- directory behavior is unchanged;
- traversal and encoded traversal are denied;
- symlinks are denied;
- aliases survive canonical slug changes;
- disabling a share disables all resolution paths;
- longest-prefix routing handles legacy IDs and filenames;
- an incorrect suffix does not resolve;
- copy operations preserve the filename and exact source policy;
- unavailable shares resolve to an explanatory response;
- legacy replay is idempotent.

### Integration tests

- publish and view a notebook file;
- download the file;
- attempt sibling stat, listing, read, and download;
- copy to an existing project;
- create a compatible project and copy;
- test same-host, cross-host, and cross-bay access;
- archive/restore the source project;
- disable and re-enable the share;
- validate filenames containing spaces, Unicode, `%`, `#`, and newlines;
- validate historical query strings such as `?viewer=share`.

### Migration tests

- replay old rows whose `path` was rewritten to a parent directory;
- preserve historically disabled records;
- re-enable only migration-disabled file rows;
- handle missing and unrestored projects;
- handle missing files without losing the alias;
- detect alias collisions deterministically;
- resume safely after interruption.

## Rollout

1. Implement schema, API, policy, routing, frontend, and migration changes.
2. Deploy to staging without running a broad replay.
3. Create new staging file shares and complete security tests.
4. Import/replay the Johannes project on staging.
5. Verify all known paper and course URLs end to end.
6. Replay a representative staging sample covering file types, missing files,
   disabled rows, spaces, Unicode, and collisions.
7. Deploy code to production with legacy backfill disabled.
8. Canary the Johannes project and a small production sample.
9. Enable Cloudflare 302 redirects and monitor alias resolution.
10. Run the production backfill with bounded concurrency and checkpoints.
11. Review the final inventory and failure report.
12. Repair or explicitly classify all failures.
13. Switch stable redirects to 308 after an observation window.

Rollback is to disable file-share resolution and legacy aliases while leaving
directory shares unchanged. Do not delete imported metadata or alias
reservations during rollback.

## Observability

Record or expose:

- canonical versus legacy alias resolution counts;
- successful, unavailable, unauthorized, and not-found outcomes;
- project/file availability reason;
- viewer grant failures;
- project-host policy denials;
- copy LRO success/failure;
- replay progress and checkpoint;
- alias collisions;
- suspicious parent/sibling access attempts.

Add sampled end-to-end probes for known historical URLs. Alert if an available
canary changes from successful resolution to not found, unavailable, or policy
failure.

## Done Criteria

- Every retained legacy file-share record has a deterministic final status.
- Every available legacy file opens through its historical ID.
- Historical filename suffixes resolve without exposing sibling content.
- Missing or unrestored files show a specific unavailable page.
- Direct file publishing works for ordinary users.
- View, download, copy, and create-project operations use exact-file policy.
- Security tests prove parent and sibling access is denied.
- Directory shares have no behavioral regression.
- Johannes's known links and broader course-link inventory work end to end.
- Cloudflare redirects preserve path/query encoding and no longer require
  per-share handling.
- Production replay is complete, resumable, and auditable.
