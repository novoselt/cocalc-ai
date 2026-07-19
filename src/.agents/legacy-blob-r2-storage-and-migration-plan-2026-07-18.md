# CoCalc Attachment Blob Architecture and Legacy Migration Plan

Date: 2026-07-18

Last revised: 2026-07-19 after auditing how blob URLs are actually produced,
copied, rendered, exported, and stored in current CoCalc.

Status: proposed implementation plan. No legacy blob data has been migrated by
this document.

The immediate migration problem is that documents restored from `cocalc.com`
contain URLs such as:

```text
https://cocalc.com/blobs/paste-0.9336086811634844?uuid=c05251d5-6100-47b7-916a-180c689c409e
```

Those URLs redirect to `cocalc.ai`, but most legacy UUIDs are absent from the
new database and return "blob not found." Missing pasted images in Jupyter
Markdown cells are the dominant reported symptom.

This plan also fixes the current storage model before importing legacy data.
The existing `blobs` row conflates immutable bytes, one uploader association,
one public identifier, access counters, and deprecated syncstring archives.
That model was adequate when blob URLs were effectively a permanent public
free-for-all. It is not adequate for bounded costs, quotas, deletion, multibay
authority, private R2 storage, and explicit public sharing.

## Executive Decision

Treat the global `/blobs` service as an **attachment/link service**, not as a
general confidential key-value store.

1. Model immutable content separately from logical attachment handles.
2. Address canonical content by full SHA-256, but expose random, unguessable
   attachment handles in new URLs.
3. Create a new handle for every upload, even when the bytes already exist.
   Handles carry attribution, quota, lifecycle, and read policy; objects carry
   bytes and integrity metadata.
4. Preserve old UUID URLs through an alias table. A legacy UUID maps to one
   synthetic compatibility handle; it is not the new physical object key.
5. Default ordinary attachment handles to `authenticated-link`: any signed-in
   user who possesses the unguessable URL may read it. Project/account fields
   are attribution and lifecycle metadata, not project-membership read ACLs.
6. Add explicit `public-link` handles for content that must render anonymously,
   including public shares and public news. Public delivery must have separate
   Cloudflare cost controls.
7. Do not attempt to record every Markdown/HTML/notebook occurrence in a
   normalized reference or grant table. CoCalc copies blob URLs as ordinary
   text and cannot observe all copies.
8. Keep PostgreSQL bytes for deployments without Cloudflare. In a
   Cloudflare-enabled deployment, store canonical bytes in a private global R2
   bucket and serve them through an authorization-aware Worker.
9. Exclude deprecated archived syncstrings from migration exactly, then delete
   the archived-syncstring creation and retrieval code in a separate reviewed
   cleanup.
10. Migrate only verified safe raster images from the legacy corpus initially.
    Do not bulk-migrate PDFs, arbitrary attachments, SVG, or opaque binary
    data merely because they share the old table.
11. Preserve the old database disk and GCS bucket, read-only, until migration
    verification and a separate retention decision are complete.

Do not import millions of legacy bytea values into the cocalc.ai production
database, and do not lock the migration into the current flawed UUID ownership
model.

## What Blobs Actually Mean in CoCalc

This section is authoritative for the product requirements. It is based on a
read of current producers and consumers, not on assumptions derived from the
generic database schema.

### Core application semantics

The current global `/blobs` service primarily stores user-pasted or uploaded
attachments whose URLs are embedded in Markdown, Slate documents, HTML, chat,
notebooks, settings, and support content. The upload route itself describes
the feature as a GitHub issue-comment-style Markdown attachment mechanism.

A blob URL is therefore normally a portable link to an attachment. It is not
normally:

- a project filesystem object;
- a Jupyter execution output store;
- a secret store;
- a generic application database value;
- an authorization boundary for confidential project state; or
- an authoritative inventory of which documents contain the link.

This distinction permits a materially simpler model than a generic object
store with a grant row for every reader and every document occurrence.

### Complete current producer and consumer inventory

The following are all active uses found in the current cocalc-ai code audit.
Future implementation work must re-run this search and update the inventory
before schema cutover.

1. **Generic authenticated attachment upload.**
   `src/packages/hub/servers/app/blob-upload.ts` implements `POST /blobs`,
   requires sign-in, accepts an optional `project_id`, verifies project
   collaboration when provided, enforces the current 25 MB limit, derives the
   legacy UUID from content, and returns a `/blobs/<filename>?uuid=<uuid>` URL.

2. **Shared frontend image upload helper.**
   `src/packages/frontend/blobs/upload-image.ts` uploads a browser `Blob`,
   optionally attributes it to a project, and returns the global blob URL.

3. **Generic frontend attachment widget.**
   `src/packages/frontend/file-upload.tsx` contains `BlobUpload`. It supports
   files beyond images and returns the same global URL. Although the product
   is image-first, current code can create non-image attachment blobs.

4. **Slate and rich-text clipboard/drop uploads.**
   `src/packages/frontend/editors/slate/upload.tsx` uploads pasted binary image
   clipboard items. Dropped or selected image files become image nodes;
   non-image files become ordinary Markdown-style links to the blob URL.

5. **Markdown input clipboard/drop/select uploads.**
   `src/packages/frontend/editors/markdown-input/component.tsx` uploads pasted
   images and selected/dropped files. Images are inserted as
   `![](/blobs/...)`; other files are inserted as `[filename](/blobs/...)`.
   Multimode editor context normally supplies the current project ID and path.

6. **Project Markdown and Slate documents.**
   The editor upload paths place attachment URLs directly in document text.
   The database does not receive an event when the URL is later copied,
   deleted, renamed, or moved inside project files.

7. **Jupyter Markdown cells.**
   Pasting an image into a Markdown cell uses the global attachment upload and
   stores the `/blobs` URL in notebook Markdown. This is the key legacy
   migration case behind reports of missing notebook images.

8. **Project chat.**
   Chat message composition and edits use
   `src/packages/frontend/chat/input.tsx`; thread/chat images also use
   `src/packages/frontend/chat/thread-image-upload.tsx` and
   `src/packages/frontend/chat/chatroom-modals.tsx`. Blob links are embedded
   in message content and may outlive the editor session that created them.

9. **Course-management rich text.**
   Assignment, handout, student-facing, and configuration text fields use the
   same editors and can contain pasted/uploaded attachment links. Explicit
   upload-enabled callers include
   `src/packages/frontend/course/common/student-assignment-info.tsx` and
   `src/packages/frontend/course/students/students-panel-student.tsx`.

10. **Task descriptions.**
    `src/packages/frontend/editors/task-editor/desc-editor.tsx` enables uploads
    in task content through the shared Markdown editor.

11. **Git commit and review comments.**
    `src/packages/frontend/chat/git-commit/review-editors.tsx` enables uploads
    in Git-related rich-text and review comments.

12. **Support requests.**
    `src/packages/frontend/support/create-modal.tsx` uploads screenshots and
    body images without a project context. These are account-attributed and
    their URLs may be exported to Zendesk or included in support email. They
    need a deliberate support/public capability policy rather than accidental
    anonymous access to every blob.

13. **Theme and identity images.**
    Account, project, chat, workspace, rootfs, and public-share theme/image
    settings use blob uploads or blob UUIDs. Public-share theme images are
    rendered to anonymous visitors and therefore require explicit
    `public-link` behavior. Relevant callers/helpers include
    `src/packages/frontend/components/theme-image-input.tsx`,
    `src/packages/frontend/components/theme-editor-modal.tsx`,
    `src/packages/frontend/account/account-preferences-other.tsx`,
    `src/packages/frontend/project/settings/sections.tsx`,
    `src/packages/frontend/project/page/flyouts/workspaces.tsx`, and
    `src/packages/frontend/projects/image.ts`.

14. **Admin news content.**
    `src/packages/frontend/admin/news/page.tsx` enables Markdown and direct
    thread-image uploads, then renders the result on a public news page. This
    is another explicit public producer.

15. **Codex/ACP generated images.**
    `src/packages/project-host/codex/generated-image-blobs.ts` calls the hub
    `db.saveBlob` path for generated images, with a project context, then
    returns a blob link for insertion in chat or another document.

16. **Direct browser rendering and downloading.**
    Markdown, HTML, notebook Markdown cells, chat, themes, and public pages
    load `/blobs` URLs directly. Safe image extensions are currently served
    inline; other extensions are forced to download. The filename in the URL
    is presentation metadata and is attacker-controlled.

17. **Chat, task, and whiteboard exports.**
    `src/packages/export/blob-assets.ts`, `src/packages/export/chat.ts`,
    `src/packages/export/tasks.ts`, and `src/packages/export/whiteboard.ts`
    scan Markdown and HTML `<img>` content for `/blobs` URLs and can fetch the
    corresponding bytes into an export asset directory. Exports are secondary
    readers; they do not establish the original attachment's ownership.

18. **Chat imports.**
    `src/packages/export/chat-import.ts` re-uploads bundled assets into the
    target project and rewrites imported references. This already demonstrates
    the correct behavior for a self-contained cross-project copy: create
    target-context handles rather than mutate the source handle.

19. **ACP prompt materialization.**
    `src/packages/lite/hub/acp/blob-materialization.ts` and its integration in
    `src/packages/lite/hub/acp/index.ts` discover blob links and materialize
    referenced images as local files for model input. This is a
    signed-in/project action, not an anonymous public read case.

### Systems that are not the global attachment service

These must remain separate even though they may also use the word "blob":

- **Jupyter execution outputs.** Current image, PDF, and iframe HTML execution
  outputs use a project-scoped Conat AKV store named from
  `jupyter/<notebook-path>` in `src/packages/jupyter/redux/actions.ts`. They do
  not use the global `/blobs` table or URL service.
- **Project file uploads.** Files uploaded in the Files UI go into the project
  filesystem and inherit project authorization and backup behavior.
- **Project backups, rootfs images, container images, and other R2 objects.**
  These use separate storage namespaces and policies.
- **Historical project socket `save_blob`, Sage, file-transfer, and LaTeX
  paths in the old cocalc.com repository.** These explain why the legacy table
  may contain non-image objects, but they are not active global-blob use cases
  in current cocalc-ai.
- **Lite's Conat AKV implementation.** Lite may store attachment bytes in an
  AKV named `blobs`, but it exposes the same application-level attachment URL
  semantics. The storage backend differs; the product model does not.

### Deprecated archived syncstrings

The old and current PostgreSQL `blobs` table also contains internal archived
syncstring/TimeTravel patch data. This is an unrelated historical space-saving
mechanism, not a public attachment feature.

Relevant remaining code includes:

- `src/packages/database/postgres/blobs/archive.ts`;
- wrappers in the PostgreSQL blob methods/types;
- `src/packages/hub/run/maintenance-syncstrings.js`;
- `getLegacyTimeTravelInfo` and `getLegacyTimeTravelPatches` in
  `src/packages/server/conat/api/db.ts` and their API declarations; and
- associated tests and package maintenance entry points.

The audit found server/API/test references but no active frontend consumer.
This code should be deleted in a dedicated cleanup after confirming production
usage metrics and backups. Regardless of cleanup timing, archived syncstring
rows are categorically excluded from attachment migration.

### Copy and paste semantics

CoCalc has two materially different copy operations:

1. Copying actual image pixels through the clipboard creates a new upload in
   the destination editor context. This should create a new handle attributed
   to the destination account/project, while deduplicating physical bytes.
2. Copying Markdown, HTML, notebook JSON, chat text, or a literal blob URL
   copies the URL verbatim. No hub event occurs, so no new project grant or
   reference row can be created reliably.

The second behavior is fundamental. Blob URLs can also be pasted into external
documents, email, support systems, source files, and exports. Therefore:

- a normalized table of every document occurrence cannot be authoritative;
- a read cannot require membership in the handle's original project without
  breaking ordinary cross-project copy/paste;
- `project_id` and `account_id` on a handle are attribution, quota, abuse, and
  lifecycle fields, not an assertion that only those principals may read;
- operations that promise a self-contained copy or import should explicitly
  re-upload/rebind assets, as chat import already does; and
- deletion of a handle can break verbatim copied links, just as deleting an
  externally linked attachment can. The UI and retention policy must make
  that behavior clear and conservative.

## Verified Current Storage State

### Current cocalc.ai implementation

- `src/packages/util/db-schema/blobs.ts` defines a global `blobs` table with
  `blob bytea`, `gcloud`, `compress`, one `project_id`, one `account_id`,
  `last_active`, `count`, and `size`.
- `src/packages/database/postgres/blobs/methods-impl.ts` writes bytes to
  PostgreSQL. An old maintenance path can move bytes to a mounted GCS store,
  but this is not an R2 implementation.
- `src/packages/hub/servers/app/blobs.ts` serves `/blobs` through the hub,
  updates access metadata, and redirects non-seed bays to the seed bay.
- Current writes route to the cluster seed bay through
  `src/packages/hub/servers/app/blob-upload.ts` and
  `src/packages/server/blobs/save.ts`.
- The current user upload limit is 25 MB.
- The UUID is derived from SHA-1 using `uuidsha1`, which modifies/truncates
  bits. It is a compatibility identifier, not a sufficient canonical modern
  content identity.
- If an upload finds an existing content UUID, the current path can extend its
  lifetime without recording the new uploader/project association. This is
  the concrete deduplication/ownership bug the handle model fixes.
- Current GET treats knowledge of the UUID as a public capability. A
  cookie-free production request returned HTTP 200 during the audit.
- Current upload quotas bound stored count/bytes but do not meter anonymous
  download requests or downloaded bytes.

A read-only production query on 2026-07-18 found 568 rows, all still containing
PostgreSQL bytea, totaling about 135 MB, with no `gcloud` markers. This corpus
is small enough to migrate and verify exhaustively.

### Legacy cocalc.com implementation

The source under `/home/user/upstream/cocalc` confirms:

- metadata and hot bytes lived in PostgreSQL;
- maintenance copied colder stored bytes to the `smc-blobs` GCS bucket and
  usually cleared PostgreSQL bytea after verification;
- a row with `blob IS NULL` and `gcloud IS NOT NULL` was fetched from GCS,
  decompressed according to the row's `compress` value, and served by the hub;
- GCS object bytes can therefore be compressed storage bytes, not necessarily
  directly recognizable image bytes;
- reads incremented `count` and updated `last_active`;
- GCS objects were keyed by legacy UUID and did not preserve a trustworthy
  filename or MIME type; and
- the one `project_id`/`account_id` association is incomplete when identical
  bytes were used in multiple contexts.

The final shutdown inventory records 23,715,443 legacy blob rows. The old
database VM and GCS bucket are currently preserved and available read-only.

### Existing R2 implementation

CoCalc already has reusable R2/S3 primitives in
`src/packages/backend/r2.ts`, `src/packages/server/project-backup/r2.ts`, and
bucket records in `src/packages/util/db-schema/buckets.ts`.

R2 location hints are best effort, not residency guarantees. A global content
object can be referenced from many accounts, projects, and regions. Use one
private global blob bucket initially. Add a separate explicit jurisdiction
realm, such as `eu`, only for contractual residency requirements.

## Goals

- Restore every recoverable, selected legacy image at its existing URL.
- Align the storage model with attachment-link behavior instead of generic
  confidential object-store behavior.
- Keep large byte payloads out of managed PostgreSQL when Cloudflare is
  configured.
- Keep PostgreSQL-only deployments simple and fully supported.
- Remove the hub and Google Cloud egress from the steady-state managed blob
  download data plane.
- Preserve ordinary signed-in copy/paste behavior across projects.
- Make anonymous rendering explicit and bounded rather than accidental.
- Support range, conditional, and cache-friendly requests safely.
- Make migration idempotent, resumable, auditable, and safe to rerun.
- Give support a lookup explaining alias, handle, object, source, migration
  state, errors, and recovery action.
- Keep multibay authority explicit.

## Non-goals

- Do not migrate archived syncstrings or legacy TimeTravel history.
- Do not turn attachments into a general secret/key-value service.
- Do not discover and normalize every blob URL occurrence in all documents.
- Do not migrate arbitrary legacy binary data in the first migration.
- Do not inline or bulk-migrate legacy SVG without a separate sanitization and
  threat-model decision.
- Do not make the old database a permanent production dependency.
- Do not make the R2 bucket or `r2.dev` publicly accessible.
- Do not infer object ownership or residency from a project's current host.
- Do not delete old GCS objects or database rows during initial success.
- Do not require Cloudflare, Workers, or R2 for CoCalc Plus/Star.

## Required Invariants

1. A canonical content object is immutable and identified by the full SHA-256
   of its canonical uncompressed bytes.
2. Every new upload creates a random attachment handle, even when its content
   object already exists.
3. Knowledge of content bytes or SHA-256 must not reveal a new attachment URL.
4. Existing legacy/current UUID URLs remain valid through explicit aliases.
5. The display filename is presentation only and never participates in object
   lookup or authorization.
6. A successful write is not readable until object, handle, and alias metadata
   are all in an `available` state.
7. Duplicate handles may share physical bytes but have independent quota,
   lifecycle, attribution, and access policy.
8. Deleting one handle never deletes bytes needed by another active handle.
9. Object deletion requires zero active handles/aliases, a grace period, a
   second reference check, cache purge, and an audit record.
10. A missing telemetry event never fails a read.
11. R2 mode fails closed if required configuration is incomplete. It never
    silently splits canonical writes between PostgreSQL and R2.
12. PostgreSQL mode needs no Cloudflare configuration.
13. Legacy source data remains read-only during migration.
14. Archived syncstring rows can never enter the public attachment namespace.

## Target Data Model

Use three concepts: objects, handles, and aliases. Do not introduce a general
`blob_grants` table in the first implementation.

### Immutable content objects

```text
blob_objects
  content_id             text primary key       # full lowercase SHA-256
  storage_backend        postgres | r2
  storage_realm          global | eu | null
  storage_bucket         text null
  storage_key            text null
  storage_state          pending | available | quarantined | deleting | missing
  size                    bigint
  detected_media_type    text
  created_at              timestamptz
  verified_at             timestamptz null
  source                  current | legacy-db | legacy-gcs | import | generated
  source_metadata         jsonb
```

An object is global within a storage realm and contains no account/project
ownership. The same bytes are stored once per realm.

### Logical attachment handles

```text
blob_handles
  handle_id               uuid primary key       # random UUIDv7 or UUIDv4
  content_id              text references blob_objects
  created_by_account_id   uuid null
  project_id              uuid null
  owning_bay_id           uuid
  original_filename       text null
  safe_filename           text null
  detected_media_type     text
  purpose                 attachment | support | theme | news | generated | legacy
  access_policy           authenticated-link | public-link | disabled
  created_at              timestamptz
  expires_at              timestamptz null
  deleted_at              timestamptz null
  last_active_day         date null
  approximate_read_count  bigint
```

A handle represents one logical upload/attachment creation, not every place
where its URL appears. The account/project fields support attribution, logical
quota, abuse response, administration, and lifecycle. They do not impose a
project-collaborator check on each read.

New URLs should use the random handle:

```text
https://cocalc.ai/blobs/<display-name>?id=<handle-id>
```

The exact query name can remain `uuid` if compatibility makes that valuable,
but new values must be random handles rather than content-derived identifiers.

### Compatibility aliases

```text
blob_aliases
  namespace               text                 # legacy-uuid, current-uuid, etc.
  alias                    text
  handle_id                uuid references blob_handles
  created_at               timestamptz
  source_metadata          jsonb
  primary key (namespace, alias)
```

Existing `?uuid=<legacy-uuid>` URLs resolve through `blob_aliases`. Migration
creates one synthetic legacy handle per selected legacy UUID and then creates
the alias. If a current and legacy UUID claim different canonical bytes, do
not overwrite either mapping; quarantine and alert.

### Why there is no occurrence/reference table

References live in unstructured Markdown, HTML, notebooks, chat records,
exports, support systems, and external documents. Verbatim copy/paste is not
observable. A normalized occurrence table would be incomplete on day one and
dangerous if used for authorization or garbage collection.

Optional search indexes may record discovered occurrences for migration,
support, or impact analysis, but they are evidence only. They must not be the
authoritative read ACL or sole deletion criterion.

### Multibay authority

The object and alias registries are documented global exceptions because a
global URL must resolve consistently. Handle creation is authorized by the
authoritative owner:

- project-attributed upload: the project's `owning_bay_id` authorizes it;
- account-only upload: the account's `home_bay_id` authorizes it;
- legacy migration: the seed migration service authorizes it; and
- public policy change: the authoritative account/project/public-share
  service authorizes it.

Cross-bay operations must use the inter-bay routing layer. A bay must not
directly mutate another bay's project/account state. Update
`table-ownership.ts`; treating the whole old `blobs` table as simply
project-owned is incorrect.

## Deployment Modes and Storage Abstraction

Add an explicit deployment setting:

```text
blob_storage_backend = auto | postgres | r2
```

- `postgres`: canonical bytes remain in PostgreSQL; hub endpoints enforce the
  same handle/access semantics. This is the default for non-Cloudflare CoCalc
  Plus/Star deployments.
- `r2`: canonical bytes are in private R2 and delivered through a Worker.
  Readiness fails if the bucket, credentials, Worker route, signing keys, or
  health checks are missing.
- `auto`: choose `r2` only when Cloudflare is configured and the complete blob
  subsystem is healthy; otherwise choose `postgres`.

Use purpose-specific blob settings and least-privilege credentials. Do not
infer readiness from project-backup R2 configuration.

Introduce a content-oriented server interface:

```ts
interface BlobObjectStore {
  put(input: PutBlobObject): Promise<StoredBlobObject>;
  head(contentId: string): Promise<BlobObjectHead | undefined>;
  get(
    contentId: string,
    options?: BlobGetOptions,
  ): Promise<BlobObjectBody | undefined>;
  delete(contentId: string): Promise<void>;
  health(): Promise<BlobStoreHealth>;
}
```

Authorization, handle creation, alias resolution, quota, and lifecycle remain
above this interface. Storage backends only manage canonical bytes.

## Object Identity and R2 Layout

Store canonical uncompressed bytes. Use deterministic keys based on full
SHA-256:

```text
blob-objects/v2/sha256/<first-2>/<next-2>/<64-hex-sha256>
```

Do not put handle IDs, legacy UUIDs, filenames, account IDs, project IDs, or
bay IDs in the object key. Custom metadata should include content SHA-256,
canonical size, detected media type, source/migration version, and creation
time.

Use one private global managed bucket initially:

- Worker/cache execution occurs near the viewer.
- Repeated reads are edge-cache hits.
- Project compute location is a weak proxy for viewer location.
- A global content object may be used by handles from multiple regions.
- Deterministic global lookup avoids a bucket-directory database query on
  every read.

Measure cold and warm p50/p95/p99 reads from major geographies using 10 KB,
1 MB, 10 MB, and 25 MB fixtures. Tune tiered cache before considering
replication. If contractual residency is needed, add an explicit `eu` realm
using an R2 EU jurisdiction bucket; location hints are not residency controls.

## Access Policy and User Experience

### Authenticated links

Default ordinary uploads to `authenticated-link`:

- any signed-in user possessing the unguessable handle URL may read;
- no project-membership database lookup is needed on each read;
- download requests and bytes are charged to the signed-in reader's applicable
  quota/abuse budget;
- copied URLs continue to work across projects and accounts; and
- the private R2 key and content hash are never exposed as authority.

This is intentionally link-oriented rather than confidential-object ACL
semantics. If a future product needs confidential attachments, add a separate
policy with explicit grants and use it only in contexts that can maintain
those grants correctly.

### Public links

Anonymous reads require an explicit `public-link` handle or a short-lived
public capability minted by an authoritative public-share renderer. Known
public producers include:

- public project/share pages and their theme images;
- public admin news;
- support-system images that must be readable by an external support service;
  and
- deliberately published/exported attachments where anonymous rendering is a
  product requirement.

Public rendering of arbitrary Markdown needs a deliberate bridge. Before
making signed-in-only reads the default, either:

1. scan/rewrite attachments when content is published and create bounded
   public handles; or
2. issue short-lived signed Worker capabilities from the public-share service.

Do not make every blob anonymous because some pages are public.

### Handle deletion and copied URLs

Deleting a handle eventually invalidates every verbatim copy of that URL. This
is expected link behavior but must be conservative:

- provide a long retention/grace period;
- warn where deletion can break embedded documents;
- allow self-contained import/copy workflows to create destination handles;
- do not garbage-collect based only on an incomplete occurrence scan; and
- retain audit/recovery metadata after logical deletion.

## Quotas and Accounting

Separate physical storage from logical usage:

- physical bytes count once per content object and storage realm;
- each active handle may charge its full logical size to the creating
  account/project, so deduplication cannot bypass quota;
- uploads always create a handle and consume handle/count quota even if the
  object already exists;
- authenticated downloads charge request/byte budgets to the reader;
- public handles charge bounded request/byte budgets to the publisher/share
  or a site-wide public budget; and
- object deletion is independent of a single handle's expiration.

The exact logical charging policy needs product approval, but it must not
preserve the current early-return behavior that loses new attribution.

## Request Flows

### Upload in both deployment modes

Initial low-risk flow:

1. Client uploads through the existing authenticated hub endpoint with
   account/project context.
2. The authoritative bay checks sign-in, collaboration, purpose, size, and
   applicable quota.
3. The server sniffs the canonical media type and computes full SHA-256 while
   streaming/spooling bytes.
4. It creates a pending random handle.
5. The object service conditionally writes the canonical content if absent.
6. It verifies size/hash and commits the object as available.
7. It commits the handle as available and returns its URL.
8. Compatibility callers may also receive/create a current-UUID alias during
   transition.

In PostgreSQL mode, `blob_objects` stores bytea. In R2 mode, it stores metadata
and private R2 stores bytes. The application behavior is identical.

Only after correctness is proven should direct browser upload use short-lived
presigned PUT URLs for one temporary key followed by server-side finalization.

### Verbatim copy and self-contained copy

- Verbatim Markdown/HTML copy requires no backend mutation and preserves the
  source handle.
- Pasting image pixels invokes upload and creates a destination handle.
- Import/export or project-copy features promising independent data must fetch
  and re-upload/rebind assets explicitly.

### Authenticated R2 read

1. Client presents its CoCalc session and handle/alias URL.
2. The edge/hub authorization path verifies sign-in, handle state/policy, and
   read budget without fetching object bytes.
3. It returns or internally forwards a short-lived Worker-verifiable
   capability containing handle, canonical content key, representation, size,
   expiry, and budget class.
4. The Worker verifies the capability locally, reads/cache-serves the private
   R2 object, applies filename/disposition headers, and streams the body.
5. Telemetry is emitted asynchronously and never blocks the response.

The exact cookie/token exchange should minimize hub lookups while preserving
revocation and quota. A direct hub callback on every byte request would
recreate the bottleneck this design is intended to remove.

### Public R2 read

1. Worker resolves an explicitly public handle or verifies a bounded public
   capability.
2. It validates the normalized handle/alias and representation.
3. It serves only GET/HEAD and at most one valid range.
4. It keys the byte cache by canonical content ID and representation, not raw
   filename/query string.
5. It sets safe content type, content disposition, `nosniff`, CSP where
   applicable, ETag, range, and conditional headers.
6. It applies public budget/rate/circuit-breaker policy before an R2 miss.

The R2 bucket stays private and `r2.dev` remains disabled.

## Access Tracking

Do not recreate the old PostgreSQL write on every GET.

Use:

1. Workers Analytics Engine for request rate, latency, status, cache outcome,
   bytes, policy class, and sampled diagnostics.
2. A deliberately deduplicated durable stream, such as Cloudflare Queue or
   daily R2 manifests, for coarse `last_active_day` and approximate counts.

The consumer must coalesce handles/content IDs, use idempotency keys, update
last activity monotonically, tolerate duplicate/out-of-order delivery, and
have a dead-letter path. Do not enqueue one message per cache hit. Emit durable
evidence on cache/R2 misses and at most a bounded sample/day for hits.

Access telemetry informs retention but cannot prove that no document contains
a copied URL.

## Denial-of-Wallet and Cost Controls

### Immediate current-production exposure

The current unauthenticated hub GET is a real denial-of-wallet risk. A
cookie-free production request returned `200`, and the bay affinity cookie can
make the first request `CF-Cache-Status: BYPASS`. A hostile client can discard
cookies or vary display names/query parameters and repeatedly force hub,
database, and Google Cloud egress.

Mitigate this independently of the R2 migration:

1. Match only GET/HEAD `/blobs/*` in Cloudflare.
2. Suppress the unnecessary bay affinity cookie or otherwise make successful
   immutable responses edge-cacheable.
3. Normalize the cache key to the validated UUID/handle and representation;
   ignore attacker-controlled display names and irrelevant query parameters.
4. Cache 2xx objects appropriately, cache misses only briefly, and never cache
   5xx.
5. Add WAF/rate rules for overall reads, cache misses, invalid IDs, ranges,
   HEAD, and high 404 ratios.
6. Monitor GCP egress and hub blob-read rate until R2 cutover.

### Required managed R2 controls

- Use R2 Standard, not Infrequent Access, for this workload.
- Authenticate ordinary handles and enforce per-reader request/byte budgets.
- Give public handles separate publisher/site budgets.
- Normalize cache by content and representation so arbitrary filename/query
  changes cannot force R2 reads.
- Cache known misses briefly by normalized handle/alias.
- Allow only GET/HEAD and at most one normalized range.
- Apply Cloudflare DDoS/WAF/bot controls to cached and uncached traffic.
- Apply stricter aggregate controls to R2 misses, range abuse, scans, and 404s.
- Set a small Worker CPU limit; never buffer or transform full objects.
- Deduplicate telemetry so abuse cannot amplify Queue costs.
- Configure Cloudflare budget alerts and CoCalc projected-cost alerts.
- Implement a global emergency mode that continues eligible cache hits but
  challenges/rejects new public origin misses and uploads.
- Test the circuit breaker before rollout. Cloudflare budget alerts are not a
  spending cap, and per-data-center WAF counters are not a global hard limit.

## Legacy Inventory

Produce immutable inventories before selecting data. Use keyset pagination,
not OFFSET, for the 23.7 million-row PostgreSQL table.

### PostgreSQL metadata inventory

Export:

- UUID;
- whether bytea exists and `octet_length(blob)`;
- `gcloud` marker;
- `compress` codec;
- logical `size`;
- `created`, `last_active`, `count`, and `expire`;
- `project_id` and `account_id` as evidence, not complete ownership;
- archived-syncstring membership; and
- relevant backup/status fields.

Write compressed, date-stamped shards plus a manifest containing database
snapshot identity, query/version, row/byte counts, min/max keys, and shard
SHA-256. Keep a durable copy outside the old VM.

### Exact archived-syncstring exclusion

Exclude before reading bytes, using the schema's actual relationship:

```sql
NOT EXISTS (
  SELECT 1
    FROM syncstrings s
   WHERE s.archived = blobs.id
)
```

Use the exact production column/table names after schema verification. Record
excluded row and byte counts in the inventory. Also exclude any hard-link or
equivalent internal archive marker discovered in historical schema versions.

This exclusion is categorical, not age-based. Archived syncstrings never enter
the migration queue, public aliases, attachment handles, or R2 prefix.

### GCS inventory

Use a GCS Storage Inventory report or checkpointed bucket inventory. Capture
key, size, generation, updated time, storage class, CRC32C, and MD5 where
available. Reconcile it with database markers into:

- metadata and source present;
- database marker with missing GCS source;
- unreferenced GCS object;
- duplicate generations; and
- size/checksum conflict.

Do not assume source bytes are uncompressed images. The row's `compress` field
is required to decode them.

### Evidence from migrated content

Build priority evidence by scanning already migrated/restored content for
legacy blob URLs in:

- notebook Markdown cells and raw notebook text;
- Markdown/HTML/Slate project files;
- project chat and course/task/git rich text;
- support records;
- public news and public-share configuration; and
- exported/imported content where available.

This evidence prioritizes migration and support. It is not an authoritative
reference/ACL/deletion graph.

## Image-Only Legacy Selection Policy

The initial migration allowlist is based on **decompressed byte signatures**,
not URL filename, GCS key, extension, or legacy metadata. The old schema and
GCS objects do not provide trustworthy MIME/filename information.

### Approved initial media types

Migrate only well-recognized safe raster image formats after robust magic-byte
and structural validation:

- PNG;
- JPEG;
- GIF;
- WebP;
- AVIF;
- BMP; and
- ICO.

Do not initially migrate:

- SVG, because it can contain active content and the current route already
  avoids treating it as a safe inline image;
- PDF;
- HTML;
- arbitrary application/octet-stream attachments;
- executable/archive formats;
- malformed or polyglot content; or
- anything identified as archived syncstring data.

If support evidence later establishes significant legitimate PDF/non-image
attachment demand, add a separately approved attachment tier served only as
download with its own threat model. Do not weaken the image allowlist silently.

### Candidate evaluation algorithm

For every metadata-selected candidate:

1. Verify it is not an archived syncstring before fetching bytes.
2. Fetch PostgreSQL bytea when present; otherwise fetch the exact inventoried
   GCS generation.
3. Decode legacy `gzip`/`zlib` storage compression according to `compress`.
4. Enforce compressed and decompressed size limits to prevent decompression
   bombs.
5. Verify canonical bytes produce the expected legacy `uuidsha1` value.
6. Compute full SHA-256 and canonical size.
7. Sniff and structurally validate the canonical bytes using a shared,
   test-covered media detector.
8. Accept only approved raster types.
9. Record the rejection reason without publishing an alias or handle.

This requires reading candidate bytes, but bulk migration already requires
reading selected content. Reduce unnecessary reads first using exact
syncstring exclusion, activity/reference evidence, and cutoff policy.

### Priority tiers within approved images

- **Tier 0:** UUIDs from active support cases and known broken migrated
  documents.
- **Tier 1:** approved images referenced in scans of already migrated/restored
  notebooks, chats, project files, support records, or public content,
  regardless of age.
- **Tier 2:** approved images created or accessed on/after the explicitly
  approved cutoff, initially proposed as two years before legacy shutdown.
- **Tier 3:** approved images associated with migrated accounts/projects,
  subject to measured count/bytes and confidence in the association.
- **Tier 4:** remaining cold content retained only in preserved legacy sources
  unless later evidence justifies expansion.

Before approving Tier 2 or Tier 3, publish selected counts, canonical/source
bytes, source split, format split, rejection counts, estimated cost/duration,
and missing/conflicting source counts.

## Legacy Migration Pipeline

Build a durable job table and CLI/LRO. Suggested states:

```text
selected -> reading -> decoded -> identity_verified -> media_verified
         -> object_uploading -> object_available -> handle_available
         -> source_missing | integrity_failed | media_rejected
         -> quarantined | retryable_failed
```

Each job records alias/UUID, tier and selection evidence, exact source and GCS
generation, compression, attempts/lease, source and canonical sizes, SHA-256,
detected format, object key/ETag, synthetic handle ID, timestamps, bounded
error detail, inventory version, and worker version.

Per-object algorithm:

1. Claim with a lease using `FOR UPDATE SKIP LOCKED` or the LRO framework.
2. Recheck archived-syncstring exclusion.
3. Read and decode the exact source with bounded resources.
4. Verify legacy UUID, full SHA-256, size, and approved raster type.
5. If the deterministic content object exists, verify all metadata; otherwise
   conditionally upload and read-back/hash during initial rollout.
6. Create one synthetic `legacy` handle with the approved access policy.
7. Atomically publish the `legacy-uuid` alias to that handle.
8. Mark the job complete only after alias resolution and byte read succeed.

Never overwrite an existing deterministic key or alias on mismatch. Quarantine
conflicts. Bound old PostgreSQL reads, GCS reads, decompression CPU/memory, R2
writes, and verification reads independently.

### Legacy handle access policy

Default migrated legacy attachments to `authenticated-link`, matching the
primary notebook/chat restoration use case while eliminating anonymous
free-for-all access. For legacy URLs discovered in content that is actively
published anonymously, create an explicit public derivative handle/capability
through the public-share migration process.

This behavior must be communicated because old links may previously have
worked without sign-in. Security and cost bounds take precedence over
preserving accidental anonymous access for all 23.7 million rows.

### On-demand recovery

Pre-migration is the preferred user experience. During transition, a valid
signed-in miss may enqueue a Tier 0 lookup through a service-authenticated
legacy source gateway. Requirements:

- UUID-only lookup, never arbitrary GCS/database paths;
- exact syncstring exclusion and image allowlist;
- request coalescing per UUID;
- bounded concurrency, decompression, and timeouts;
- short negative-result caching;
- audit logs and account rate limits;
- no direct Worker connection to PostgreSQL; and
- no permanent dependency on the old VM.

Do not put synchronous legacy fetching on the anonymous Worker path.

## Current cocalc.ai Migration Before Legacy Bulk Data

Use the small current corpus to prove the design:

1. Add object/handle/alias schema while keeping current behavior operational.
2. Backfill one compatibility handle and `current-uuid` alias per current row.
3. Preserve existing account/project fields as attribution evidence.
4. Mirror canonical bytes to a private staging R2 bucket and verify every
   SHA-256, size, media type, and read response.
5. Update all upload producers to create random handles even on content dedup.
6. Update all active consumers in the enumerated inventory to accept new
   handle URLs and compatibility aliases.
7. Deploy authenticated/public Worker paths and compare with PostgreSQL mode.
8. Exercise cross-project URL copy, pixel paste, chat import, support images,
   public news, public shares, exports, and ACP materialization.
9. Canary production reads with PostgreSQL fallback.
10. Make R2 canonical only after exhaustive verification and a sustained
    discrepancy-free window.
11. Retain PostgreSQL bytes for rollback, then clear them in bounded batches
    after backups and final verification.

Because the corpus is about 135 MB, use exhaustive verification, not sampling.

## URL and Redirect Compatibility

Keep legacy/current URLs working through aliases:

```text
https://cocalc.com/blobs/<display-name>?uuid=<legacy-uuid>
https://cocalc.ai/blobs/<display-name>?uuid=<legacy-or-current-uuid>
```

New uploads use random handle URLs. Filename variation must not change object
lookup, authorization, byte-cache key, or R2 operation count.

Test spaces, Unicode, quotes, percent escapes, missing extensions, misleading
extensions, parameter order, unrelated parameters, GET, HEAD, one range,
invalid range, conditionals, ETag, current aliases, legacy aliases, random
handles, misses, disabled handles, and quarantined objects.

Content type comes from trusted byte detection. Only approved safe image types
may be inline; all other supported types are attachment downloads. Always set
`nosniff` and suitable CSP/Content-Disposition.

## Retention, Deletion, and Backup

- Keep old GCS/database sources unchanged during rollout.
- Disable accidental lifecycle deletion on canonical object prefixes.
- Treat handles/aliases as authoritative liveness roots, not discovered
  document occurrences.
- Garbage-collect only after no active handle/alias remains, a long grace
  period, and a second transactional check.
- Purge edge cache for legal/security deletion or handle disablement.
- Back up object/handle/alias/job metadata through normal database backups.
- Export immutable manifests containing content ID, key, size, media type,
  ETag, state, and legacy alias evidence.
- Decide separately whether R2 objects require another realm/provider backup.
- In PostgreSQL mode, normal database backup remains the byte backup.

## Archived Syncstring Code Removal

After metrics confirm no active production frontend depends on the deprecated
archive RPCs:

1. disable the maintenance task that creates archived syncstring blobs;
2. remove archive creation and retrieval implementations;
3. remove Conat API declarations and server wrappers;
4. remove obsolete tests and package maintenance entry points;
5. retain only any narrowly required read-only forensic tooling outside the
   public application; and
6. verify that no new `syncstrings.archived` values are created.

This cleanup must have its own commit/rollout and database retention review. It
must not block the immediate migration exclusion.

## Operations and Support Tooling

Suggested commands:

```text
cocalc blob backend status
cocalc blob lookup <handle-or-alias>
cocalc blob verify <handle-or-alias>
cocalc blob migrate-current --dry-run
cocalc legacy-blob inventory --snapshot <name>
cocalc legacy-blob plan --images-only --cutoff <date>
cocalc legacy-blob migrate --tier 0 --concurrency <n>
cocalc legacy-blob retry <uuid>
cocalc legacy-blob verify --manifest <name>
```

Mutation commands require fresh admin elevation. Bulk commands need dry-run,
bounded independent concurrency, checkpointing, structured JSON, leases, and
resume tokens.

Support lookup must show:

- requested handle/alias and normalized resolution;
- object state, SHA-256, size, and detected media type;
- attribution and access policy without exposing it publicly;
- legacy database/GCS source and generation;
- archived-syncstring exclusion result;
- tier/selection evidence and media-filter result;
- migration attempts and classified errors; and
- safe prioritize/retry/disable actions with audit logs.

## Metrics and Alerts

Track:

- handle resolutions by policy, status, and source;
- Worker GET/HEAD/range rates, bytes, latency, and cache outcomes;
- R2 reads and misses separately from edge cache hits;
- authenticated/public quota rejections;
- high-miss/404/range clients and aggregate abuse blocks;
- projected Worker/R2/Queue/GCP egress cost;
- emergency-mode state;
- upload pending age and finalize failures;
- object/hash/media integrity failures;
- telemetry lag/dead letters;
- migration counts/bytes by source, tier, format, and state;
- archived-syncstring rows excluded;
- media-rejected candidates by detected type/reason;
- aliases whose handles/objects are missing; and
- objects with zero handles versus handles with missing objects.

Critical alerts include available metadata with missing bytes, alias conflict,
checksum mismatch, Worker/R2 outage after fallback removal, cost-rate threshold
crossing, emergency mode activation, legacy source disappearance, and
unexpected selected-object count decrease.

## Test Plan

### Application semantics

- Pixel paste into another project creates a new handle but shares content.
- Verbatim Markdown/HTML copy preserves the source handle and remains readable
  by a signed-in destination user.
- Duplicate upload creates two handles and one object.
- Logical quota is charged per approved handle policy despite deduplication.
- Chat import rebinds/re-uploads bundled assets.
- Jupyter Markdown pasted images use global handles.
- Jupyter execution outputs remain in project-scoped AKV and are unaffected.
- Support, theme, news, public-share, course, task, git, chat, export, import,
  ACP materialization, and generated-image paths are covered explicitly.

### Storage and access

- PostgreSQL and R2 object-store contract tests.
- No-Cloudflare deployment with no Worker/R2 settings.
- Pending object or handle is never readable.
- Random handle does not reveal SHA-256 or deterministic object key.
- Authenticated-link denies anonymous reads and permits signed-in link holders.
- Public-link works anonymously within public budgets.
- Disabled/deleted handles stop resolving and trigger cache purge.
- Alias and handle URLs return identical canonical bytes.
- Retry is idempotent after failure at every upload/finalize transition.
- Range, conditional, filename, MIME, `nosniff`, and CSP behavior.

### Legacy fixtures

- DB-only, GCS-only, identical dual-source, conflicting dual-source, and
  missing-source rows.
- gzip, zlib, uncompressed, malformed, truncated, and decompression-bomb data.
- archived syncstring row that is provably never fetched/migrated.
- valid PNG/JPEG/GIF/WebP/AVIF/BMP/ICO fixtures.
- SVG/PDF/HTML/archive/executable/opaque/polyglot fixtures rejected.
- UUID mismatch and existing SHA-256/object/alias conflict.
- old image referenced by a migrated notebook included in Tier 1.

### Abuse and load

- Repeated filename/query variants cause one canonical R2 read.
- Distributed valid-format misses, scans, HEAD floods, and tiny ranges.
- Signed-in per-reader and anonymous public budget exhaustion.
- Cost projections at 10 million, 100 million, and 1 billion requests.
- Emergency mode serves eligible cache hits but blocks/challenges origin misses.
- Worker/R2 outage, Queue delay/replay, and hub restart during finalization.
- Migration concurrency ramp while monitoring old DB/GCS and decompression
  resources.

## Rollout Phases and Gates

### Phase 0: Immediate exposure reduction

- Fix current Cloudflare caching/cookie behavior for `/blobs`.
- Add normalized cache and rate/cost alerts around the current hub route.
- Keep uploads unchanged.

Gate: cookie-free repeated requests do not repeatedly cause GCP egress, and
abuse alerts/circuit-breaker behavior are tested.

### Phase 1: Usage and schema correctness

- Land objects, handles, aliases, backend selection, and object-store
  abstraction with PostgreSQL still canonical.
- Update every producer/consumer in the application inventory.
- Fix duplicate upload attribution/quota behavior.

Gate: application semantics and PostgreSQL-only tests pass with no Cloudflare
configuration.

### Phase 2: Private R2 staging canary

- Provision private staging bucket, Worker, signing keys, telemetry, budgets,
  and circuit breaker.
- Mirror and exhaustively verify staging/current objects.
- Test authenticated and explicit public paths, failure injection, and abuse.

Gate: zero byte/header/policy discrepancies and successful rollback.

### Phase 3: Current production corpus

- Backfill compatibility handles/aliases.
- Mirror all current objects and verify every byte.
- Canary Worker reads, then R2-first reads with PostgreSQL fallback.
- Enable R2 writes and retain DB rollback bytes.

Gate: sustained zero integrity/policy errors, acceptable latency/cost, healthy
telemetry, and tested emergency/rollback paths.

### Phase 4: Archived-syncstring shutdown and legacy inventory

- Stop archive creation after usage verification.
- Complete immutable database/GCS inventories and exact exclusion counts.
- Scan migrated content for priority UUID evidence.
- Calculate image candidates by tier, format, bytes, source, and rejection.

Gate: every candidate is non-syncstring and has auditable source/selection
evidence; cleanup rollout has independent rollback/review.

### Phase 5: Legacy image pilot

- Migrate support cases and a stratified fixture/sample.
- Validate real notebook/chat/public-content rendering.
- Exercise support lookup, media rejection, retry, and conflict quarantine.

Gate: all recoverable pilot images serve correctly and every failure has a
classified evidence state.

### Phase 6: Tiered image migration

- Run Tier 0 and Tier 1 first.
- Run approved Tier 2/Tier 3 with bounded independent concurrency.
- Continuously reconcile source, manifest, object, handle, alias, and reads.

Gate: the selected manifest is fully accounted for as available or a documented
terminal evidence state.

### Phase 7: Tail and source-retention decision

- Observe signed-in misses and support demand.
- Optionally enable bounded on-demand image recovery.
- Consider a separately designed non-image attachment tier only from evidence.
- Make a separate reviewed decision about old VM/GCS retention.

Gate: no source is deleted merely because the selected image migration
completed.

## Rollback Strategy

- Keep PostgreSQL canonical until R2 object/handle/alias behavior is proven.
- Preserve PostgreSQL read fallback and current bytea during R2 canary.
- Make Worker routing independently reversible from hub deploys.
- Keep R2 objects immutable; rollback changes metadata/routing, not bytes.
- Make migration jobs idempotent and source-read-only.
- Never delete legacy source data or current bytea in an application deploy.
- Keep archived-syncstring code removal separate from schema/data deletion.

## Decisions Requiring Explicit Approval

1. Exact signed Worker token/cookie exchange and revocation behavior.
2. Public-share/news/support mechanism: durable public handles versus
   short-lived renderer-issued capabilities.
3. Logical quota charging per handle and attribution split between account and
   project.
4. Legacy image cutoff after inventory count/byte results.
5. Exact safe raster allowlist and validation library; SVG remains excluded by
   default.
6. Retention/grace period for deleted handles and zero-handle objects.
7. Whether managed production needs an EU jurisdiction realm now.
8. How long current PostgreSQL rollback bytes remain after R2 cutover.
9. Whether to operate the temporary signed-in legacy fallback gateway.
10. Whether R2 canonical objects need independent replication/backup.
11. Long-term retention of cold/non-image legacy sources.
12. Whether approximate counts plus monotonic last-active day are sufficient.

## Recommended First Implementation Slice

Do not start with 23.7 million legacy rows. Implement:

1. object/handle/alias schema and PostgreSQL object store;
2. random-handle uploads and correct duplicate attribution/quota;
3. compatibility aliases for the small current corpus;
4. explicit authenticated/public read policies across every enumerated active
   use case;
5. Cloudflare immediate denial-of-wallet mitigation;
6. private staging R2 object store and Worker;
7. exhaustive migration/verification of current staging and production blobs;
8. archived-syncstring exclusion inventory and creation shutdown; and
9. a Tier 0 legacy safe-raster pilot.

This sequence validates real attachment behavior and avoids importing legacy
data into another temporary abstraction.

## Relevant Source References

Current application and storage:

- `src/packages/hub/servers/app/blob-upload.ts`
- `src/packages/hub/servers/app/blobs.ts`
- `src/packages/frontend/blobs/upload-image.ts`
- `src/packages/frontend/file-upload.tsx`
- `src/packages/frontend/editors/slate/upload.tsx`
- `src/packages/frontend/editors/markdown-input/component.tsx`
- `src/packages/frontend/support/create-modal.tsx`
- `src/packages/jupyter/redux/actions.ts`
- `src/packages/server/blobs/save.ts`
- `src/packages/server/conat/api/db.ts`
- `src/packages/database/postgres/blobs/methods-impl.ts`
- `src/packages/database/postgres/blobs/archive.ts`
- `src/packages/hub/run/maintenance-syncstrings.js`
- `src/packages/server/membership/blob-limits.ts`
- `src/packages/util/db-schema/blobs.ts`
- `src/packages/util/db-schema/table-ownership.ts`
- `src/packages/backend/r2.ts`
- `src/packages/server/project-backup/r2.ts`
- `src/packages/util/db-schema/buckets.ts`
- `src/.agents/scalable-architecture.md`
- `src/.agents/legacy-project-migration-recovery-plan-2026-07-09.md`

Legacy source and operations:

- `/home/user/upstream/cocalc/src/packages/database/postgres/blobs.ts`
- `/home/user/upstream/cocalc/src/packages/database/postgres-blobs.coffee`
- `/home/user/kucalc/cluster2/notes/2026-shutdown.md`

## Relevant Cloudflare References

- R2 data location and jurisdictions:
  https://developers.cloudflare.com/r2/reference/data-location/
- R2 Workers API, ranges, and conditional requests:
  https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- R2 public buckets and custom domains:
  https://developers.cloudflare.com/r2/buckets/public-buckets/
- R2 cache consistency:
  https://developers.cloudflare.com/r2/reference/consistency/
- R2 presigned URLs:
  https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Workers Analytics Engine limits:
  https://developers.cloudflare.com/analytics/analytics-engine/limits/
- Cloudflare Queues batching, delivery, and pricing:
  https://developers.cloudflare.com/queues/configuration/batching-retries/
  https://developers.cloudflare.com/queues/reference/delivery-guarantees/
  https://developers.cloudflare.com/queues/platform/pricing/
- R2 and Workers pricing:
  https://developers.cloudflare.com/r2/pricing/
  https://developers.cloudflare.com/workers/platform/pricing/
- Cache keys and cache control:
  https://developers.cloudflare.com/cache/how-to/cache-keys/
  https://developers.cloudflare.com/cache/concepts/cache-control/
- WAF rate limiting:
  https://developers.cloudflare.com/waf/rate-limiting-rules/
  https://developers.cloudflare.com/waf/rate-limiting-rules/request-rate/
- Cloudflare budget alerts:
  https://developers.cloudflare.com/billing/manage/budget-alerts/
