# CoCalc Attachment Blob Architecture and Legacy Migration Plan

Date: 2026-07-18

Last revised: 2026-07-19 after auditing how blob URLs are actually produced,
copied, rendered, exported, and stored in current CoCalc, including the Jupyter
syncdoc-to-`.ipynb` serialization boundary.

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
free-for-all. The durable public-link behavior was useful and is required for
portable documents, but the implementation lacks bounded uploads, canonical
edge caching, modern content identity, explicit retention, and denial-of-wallet
controls.

## Executive Decision

Treat the global `/blobs` service as an **attachment/link service**, not as a
general confidential key-value store.

1. Model immutable content separately from logical attachment handles.
2. Address canonical content by full SHA-256, but expose random, unguessable
   attachment handles in new URLs.
3. Create a new handle for every upload, even when the bytes already exist.
   Handles carry attribution, quota, purpose, and policy; objects carry bytes
   and integrity metadata.
4. Preserve old UUID URLs through an alias table. A legacy UUID maps to one
   synthetic compatibility handle; it is not the new physical object key.
5. Default verified safe raster images to `durable-public-image`: anyone with
   the random, unguessable URL may read it without authentication. This is
   required because URLs are copied into notebooks, repositories, exports,
   course copies, support systems, and external documents.
6. Do not expire or delete durable image handles when the originating account
   or project is deleted. Upload attribution exists for quota and abuse
   controls, not as the image's lifetime or read-authorization boundary.
7. Do not attempt to record every Markdown/HTML/notebook occurrence in a
   normalized reference or grant table. CoCalc copies blob URLs as ordinary
   text and cannot observe all copies.
8. Keep PostgreSQL bytes for deployments without Cloudflare. In a
   Cloudflare-enabled deployment, store canonical bytes in a private global R2
   bucket and serve them through a cache- and cost-aware Worker.
9. Exclude deprecated archived syncstrings from migration exactly, then delete
   the archived-syncstring creation and retrieval code in a separate reviewed
   cleanup.
10. Migrate every recoverable verified safe raster image from the legacy
    attachment corpus, ordered by evidence/activity priority. Do not
    bulk-migrate PDFs, arbitrary attachments, SVG, or opaque binary data merely
    because they share the old table.
11. Give Jupyter notebooks two transparent representations. Live syncdoc
    Markdown keeps the same durable global image URLs used by chat, tasks, and
    Markdown files, so copying raw or rich Markdown between cells, projects,
    and editors works unchanged. Every ordinary `.ipynb` save vendors those
    images into standard native Jupyter attachment MIME bundles, and load
    restores the global-link representation. Users must not need a special
    "portable export" operation.
12. Preserve the old database disk and GCS bucket, read-only, until migration
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
   Pasting an image into a Markdown cell currently uses the global attachment
   upload and stores the `/blobs` URL in notebook Markdown. This is the key
   legacy migration case behind reports of missing notebook images.

   CoCalc also has partial support for standard Jupyter cell attachments.
   Import currently copies native base64 attachment data into the syncdoc;
   export only understands that base64 form; the frontend renderer only
   renders that form; and `add_attachment_to_cell` waits for a historical
   `load` to `sha1` conversion that is not implemented by the active code
   found in this audit. In contrast, execution outputs already use an
   asynchronous project-scoped Conat AKV and a two-pass `.ipynb` serializer
   that resolves content references at save time.

   The target keeps durable global URLs in the live syncdoc but uses standard
   native attachments in the serialized `.ipynb`. Large bytes stay out of
   realtime synchronization, patches, TimeTravel history, conflict resolution,
   and every affected revision; raw Markdown copied between notebooks or
   projects remains meaningful; and the ordinary file on disk is standards
   compliant and self-contained.

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
    use the durable public image policy. The UI must warn that these random
    URLs are public and must not be used for sensitive screenshots; a future
    confidential support attachment path must be separate.

13. **Theme and identity images.**
    Account, project, chat, workspace, rootfs, and public-share theme/image
    settings use blob uploads or blob UUIDs. Public-share theme images are
    rendered to anonymous visitors and therefore require durable public image
    behavior. Relevant callers/helpers include
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
    referenced images as local files for model input. The action itself is tied
    to a signed-in/project workflow even though the durable source image is
    public.

### Systems that are not the global attachment service

These must remain separate even though they may also use the word "blob":

- **Jupyter execution outputs.** Current image, PDF, and iframe HTML execution
  outputs use a project-scoped Conat AKV store named from
  `jupyter/<notebook-path>` in `src/packages/jupyter/redux/actions.ts`. They do
  not use the global `/blobs` table or URL service. This store is best effort,
  capped at 100 MB, and currently uses the default `discard_policy: old`.
- **Jupyter native cell attachment bundles.** In the target implementation
  these are the self-contained on-disk representation of live durable global
  image links, not a second project-local object store and not the live syncdoc
  representation.
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
- a safe image read cannot require sign-in or membership in the handle's
  original project without breaking course copies, GitHub/Colab use, exports,
  email, and ordinary cross-project copy/paste;
- `project_id` and `account_id` on a handle are attribution, quota, abuse, and
  provenance fields, not an assertion that only those principals may read or
  that deleting them should delete the image;
- operations that promise a self-contained copy or import should explicitly
  re-upload/rebind assets, as chat import already does; and
- routine deletion of a durable image handle would break copies that CoCalc
  cannot discover. Such handles therefore survive account/project deletion and
  are removed only through an explicit exceptional legal, privacy, security,
  or abuse process that acknowledges link breakage.

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

- Restore every recoverable legacy safe raster image at its existing URL.
- Align the storage model with attachment-link behavior instead of generic
  confidential object-store behavior.
- Keep large byte payloads out of managed PostgreSQL when Cloudflare is
  configured.
- Keep PostgreSQL-only deployments simple and fully supported.
- Remove the hub and Google Cloud egress from the steady-state managed blob
  download data plane.
- Preserve image rendering after course distribution, account/project
  deletion, copying to another project, and publication on GitHub or Colab.
- Make anonymous durable image delivery explicit and operationally bounded.
- Keep large image bytes out of realtime collaboration and TimeTravel state.
- Make every ordinary `.ipynb` file standards compliant and self-contained by
  reconstructing native cell attachment MIME bundles at the syncdoc/disk
  boundary without putting base64 data into realtime collaboration state.
- Ensure GitHub, Colab, local Jupyter, downloads, course copies, and offline
  readers of a saved notebook never need to fetch its embedded images from
  CoCalc or Cloudflare.
- Support range, conditional, and cache-friendly requests safely.
- Make migration idempotent, resumable, auditable, and safe to rerun.
- Give support a lookup explaining alias, handle, object, source, migration
  state, errors, and recovery action.
- Keep multibay authority explicit.

## Non-goals

- Do not migrate archived syncstrings or legacy TimeTravel history.
- Do not turn attachments into a general secret/key-value service.
- Do not discover and normalize every blob URL occurrence in all documents.
- Do not store newly pasted image bytes as base64 native Jupyter attachments in
  the live collaborative notebook representation.
- Do not require a special export command to make an ordinarily saved Jupyter
  notebook portable.
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
7. Duplicate handles may share physical bytes but have independent upload
   accounting, attribution, purpose, and policy.
8. A `durable-public-image` handle remains anonymously readable after its
   originating account or project is deleted.
9. Routine account/project deletion, quota expiration, inactivity, or missing
   occurrence evidence never deletes a durable public image handle.
10. Exceptional legal, privacy, security, or abuse removal requires an
    explicit audited action, cache purge, tombstone, and acknowledgement that
    external documents may break.
11. Object deletion requires zero durable handles/aliases and zero other active
    handles, plus a grace period and a second reference check.
12. A missing telemetry event never fails a read.
13. R2 mode fails closed if required configuration is incomplete. It never
    silently splits canonical writes between PostgreSQL and R2.
14. PostgreSQL mode needs no Cloudflare configuration.
15. Legacy source data remains read-only during migration.
16. Archived syncstring rows can never enter the public attachment namespace.
17. Live Jupyter Markdown uses durable global URLs so raw input copied across
    cells, projects, and CoCalc rich-text editors remains valid.
18. Every successfully saved `.ipynb` contains native attachment bytes for its
    eligible CoCalc images and has no external CoCalc dependency for them.
19. Loading an unchanged CoCalc-saved `.ipynb` reuses its recorded handles and
    never creates duplicate handles or consumes additional publication quota.

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
  created_by_account_id   uuid null             # ON DELETE SET NULL
  project_id              uuid null             # ON DELETE SET NULL
  created_via_bay_id      uuid
  original_filename       text null
  safe_filename           text null
  detected_media_type     text
  purpose                 attachment | support | theme | news | generated | legacy
  access_policy           durable-public-image | authenticated-attachment
                          | explicit-public-attachment | disabled
  retention_policy        durable | revocable
  created_at              timestamptz
  expires_at              timestamptz null       # never set for durable images
  deleted_at              timestamptz null
  last_active_day         date null
  approximate_read_count  bigint
```

A handle represents one logical upload/attachment creation, not every place
where its URL appears. The account/project fields support attribution, upload
quota, abuse response, and administration. They do not impose a
project-collaborator check on safe image reads and do not control durable image
lifetime. Account/project deletion nulls or anonymizes provenance without
deleting the handle.

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

The object, durable handle, and alias registries are documented global
exceptions because a global URL must resolve consistently after its originating
account/project disappears. Handle creation is authorized by the authoritative
owner at upload time:

- project-attributed upload: the project's `owning_bay_id` authorizes it;
- account-only upload: the account's `home_bay_id` authorizes it;
- legacy migration: the seed migration service authorizes it; and
- exceptional disable/removal: a narrowly authorized global administrative
  service performs and audits it.

After creation, the seed-global attachment service is authoritative for a
durable handle's availability. The originating bay is provenance, not a
liveness dependency.

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

### Durable public images

Every newly uploaded, byte-verified safe raster image defaults to
`durable-public-image`:

- anyone possessing the random, unguessable handle or compatibility alias may
  read it without authentication;
- the URL continues to work in copied course notebooks, other CoCalc projects,
  GitHub, Colab, exports, email, support systems, and ordinary browsers;
- account or project deletion does not expire, disable, or garbage-collect the
  handle;
- the original account/project remains provenance for quota and abuse response
  while it exists, then is nulled or anonymized according to account-deletion
  policy;
- the private R2 key and canonical content hash are not the public authority;
  and
- no project-membership or hub/database lookup is required on a warm edge read.

The random URL is an anonymized public capability, not a confidentiality
guarantee. Upload UI and documentation must warn users not to paste sensitive
images into this service. A separate authenticated attachment feature is
required for confidential content.

Known image consumers such as public shares, public news, support systems, and
external notebooks therefore use the same durable image policy rather than a
special promotion step that CoCalc cannot reliably observe.

### Non-image and confidential attachments

The durable-public default applies only to validated safe raster images.
Non-image uploads need a separately approved policy. During rollout, keep them
on the existing path or classify them as `authenticated-attachment` with an
explicit retention policy; do not silently make arbitrary HTML, archives,
documents, or executables permanently public.

If a future confidential attachment feature is needed, use explicit grants in
that feature only. Do not add project ACL semantics to durable image URLs,
because copied documents cannot maintain those grants.

### Jupyter live-link and on-disk attachment representations

CoCalc rich text crosses application boundaries. A user can copy raw Markdown
input or rendered rich content between notebook cells, notebooks in different
projects, chat, tasks, course content, and Markdown files. A cell-local
`attachment:name` copied as raw Markdown is dangling everywhere except the
source cell. Therefore Jupyter must not introduce a different live link model
from the rest of CoCalc.

The two representations are:

1. **Live collaborative representation.** Notebook Markdown contains the same
   random durable `/blobs/...` image URL used by every other CoCalc editor. The
   syncdoc and TimeTravel contain only this small URL. Raw and rich-text copy
   preserve a meaningful link across cells, projects, editors, email, and
   external documents.
2. **Filesystem `.ipynb` representation.** A serialized copy of each Markdown
   cell rewrites eligible CoCalc image URLs to
   `attachment:<cell-local-name>` and stores the corresponding base64 MIME
   bundle in that cell's standard `attachments` object. This is the normal file
   written by Save, autosave, download, Git, course distribution, project copy,
   and backup; it is not a special export.

This intentionally stores one global immutable image object plus copies inside
ordinary notebook files that reference it. Content deduplication keeps the
global physical object bounded, while the on-disk copy provides standard
Jupyter portability and recovery. The base64 bytes never enter syncdoc patches
or TimeTravel. Once the file is saved, GitHub, Colab, local Jupyter, downloads,
course copies, and offline readers render its images without any request to
CoCalc, Cloudflare, or R2.

#### Save boundary

Extend the existing asynchronous `toIpynb()` save path. For each Markdown cell
it must:

1. parse only supported CoCalc durable image URLs, never arbitrary external
   URLs;
2. resolve every handle/alias to validated safe raster bytes and exact MIME;
3. assign collision-safe cell-local attachment names and preserve repeated
   references correctly;
4. rewrite only the serialized Markdown copy to `attachment:<name>`;
5. emit the standard attachment MIME bundle;
6. record a versioned CoCalc cell-metadata mapping from attachment name and
   content identity back to the original durable handle; and
7. atomically replace the `.ipynb` only after all referenced authored images
   are available.

Missing execution output may remain best effort under the existing product
policy. Missing user-authored image data is different: save must fail clearly
and preserve the last valid on-disk notebook rather than silently omit an image
or write a partially portable file. The serializer must bound total decoded
attachment bytes and avoid loading an entire large notebook corpus into memory
at once.

Native Jupyter attachments are cell-local. If the same image is referenced by
multiple cells, each cell that uses it needs its own attachment entry even
though the global object is deduplicated.

#### Import/load boundary

Before an `.ipynb` cell is written to the live syncdoc:

1. parse and validate every native attachment name, MIME variant, encoded size,
   decoded size, and safe raster payload;
2. preserve all MIME variants during parsing rather than overwriting all but
   the last one, as the current importer does;
3. when valid CoCalc metadata names an available durable handle with matching
   content identity, reuse that handle without creating or charging another
   logical upload;
4. otherwise ingest the safe image through the authenticated global attachment
   service, deduplicate physical content, create one new attributed durable
   handle, and enforce normal upload/publication quotas;
5. rewrite the live Markdown from `attachment:<name>` to that durable global
   URL; and
6. only then commit the imported cell records to the syncdoc.

The conversion must be asynchronous, idempotent, and transactional from the
user's perspective. Reloading an unchanged CoCalc-saved notebook must not
create a new handle every time. External notebooks without CoCalc metadata get
new handles once, and the next save records the mapping. Unsupported or
confidential non-image attachments must not be silently published; retain them
in a separately designed path or block import with a precise explanation.

The current `IPynbImporter` and `processAttachments` are synchronous and only
support an incomplete base64 shape, so this requires an asynchronous pre-import
and pre-save transformation rather than a small local type change.

#### Clipboard behavior

- Copying raw Markdown from a live notebook copies the durable global URL and
  therefore works in another cell, notebook, project, chat, task, or Markdown
  file without a backend copy event.
- Copying rendered pixels invokes the destination editor's normal image upload
  and creates a new destination-attributed handle while sharing canonical
  bytes.
- Copying the serialized `.ipynb` file carries native attachments and is
  self-contained in Jupyter, GitHub, Colab, and course/project file copies.
- Importing that file into CoCalc reuses recorded handles when possible and
  otherwise creates handles exactly once.

#### Existing and external references

Existing and legacy notebook Markdown containing `/blobs` URLs follows the same
save conversion and continues to work through durable public aliases. Other
external image URLs remain external by default; fetching arbitrary URLs during
save would introduce SSRF, availability, credential, and nondeterminism risks.
An explicit, bounded "vendor external images" operation may be designed
separately.

Global durable public images remain necessary for all live rich-text contexts,
old notebooks, legacy migration, and documents already published outside
CoCalc. The global store is what makes cross-editor and cross-project Markdown
copy simple; native Jupyter attachments make the saved notebook portable.

This portability guarantee is intentionally specific to `.ipynb`, which is a
standard interchange format routinely opened by GitHub, Colab, local Jupyter,
and offline tools. CoCalc chat, tasks, and application Markdown/rich-text
documents may retain durable CoCalc attachment URLs as a reasonable platform
dependency. Existing export features may materialize their assets, but this
plan does not require every raw CoCalc document to become independently
portable to another site.

Markdown has no standard native attachment bundle analogous to nbformat.
Inlining data URLs would put large binary strings back into collaboration and
TimeTravel, while relative image files require a sidecar directory and do not
survive raw cross-project Markdown copy. Durable attachment URLs are therefore
the intentional practical representation for live Markdown-based formats.

### Exceptional removal

There is no routine user/account/project lifecycle deletion for durable public
images. Removal is limited to explicit legal, privacy, security, or abuse
actions. The operation must:

- require elevated authorization and a reason;
- warn that unknown external documents will break;
- disable every applicable handle/alias;
- purge Cloudflare caches;
- retain a non-sensitive audit tombstone; and
- delete canonical bytes only when no other durable handle or alias needs them.

## Quotas and Accounting

Separate physical storage from logical usage:

- physical bytes count once per content object and storage realm;
- each durable handle may charge its full logical size to the creating
  account/project's publication allowance, so deduplication cannot bypass
  quota;
- uploads always create a handle and consume handle/count quota even if the
  object already exists;
- enforce encoded bytes, decoded bytes, pixel dimensions, per-minute/day
  upload counts, rolling uploaded bytes, and cumulative durable-publication
  limits at authenticated upload time;
- deleting a project/account or exceptionally removing a handle does not reset
  anti-abuse cumulative/rolling upload counters;
- anonymous reads consume site-wide request/origin-miss budgets protected by
  edge caching, WAF rules, anomaly detection, and a circuit breaker; and
- report global physical durable-image bytes and projected monthly storage cost
  so admission policy can be tightened before a hard site budget is exceeded.

The exact membership publication allowances need product approval, but they
must be finite, explicit, and enforced before accepting permanent bytes. The
implementation must not preserve the current early-return behavior that loses
new attribution.

Importing an external notebook with native attachments creates global durable
handles and therefore consumes the same finite authenticated publication quota
as equivalent image pastes. Reopening an unchanged CoCalc-saved notebook must
reuse its metadata-recorded handles and consume no additional handle or byte
quota. Enforce aggregate encoded/decoded attachment limits before import so a
single notebook cannot bypass upload admission controls.

## Request Flows

### Upload in both deployment modes

Initial low-risk flow:

1. Client uploads through the existing authenticated hub endpoint with
   account/project context.
2. The authoritative bay checks sign-in, collaboration, purpose, size, and
   applicable quota.
3. The server enforces compressed/decoded image limits, sniffs and validates
   the canonical media type, and computes full SHA-256 while
   streaming/spooling bytes.
4. For a safe raster image, it creates a pending random
   `durable-public-image` handle. Other media follows a separately approved
   non-image policy.
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
- CoCalc project/course copies may preserve durable public image URLs safely.
- New Jupyter Markdown image paste uses the same global upload flow as every
  other live rich-text editor, preserving cross-editor and cross-project copy.
- Every ordinary Jupyter save embeds those native attachment bytes in the
  `.ipynb`, so file/project/course copy, download, Git, Colab, and other Jupyter
  implementations receive a self-contained notebook automatically.
- Import/export features for other document types that promise a self-contained
  artifact must still fetch and rebind or embed assets explicitly.

### Durable public R2 read

1. The Worker strictly validates and resolves the random handle or
   compatibility alias without requiring a CoCalc session.
2. It verifies that the handle is available and has
   `durable-public-image` policy.
3. It serves only GET/HEAD and at most one valid range.
4. It keys the byte cache by canonical content ID and representation, not raw
   filename/query string.
5. It sets safe content type, content disposition, `nosniff`, CSP where
   applicable, ETag, range, and conditional headers.
6. It applies site-wide budget/rate/circuit-breaker policy before an R2 miss.
7. It streams the private R2 object without buffering and emits bounded
   asynchronous telemetry.

The R2 bucket stays private and `r2.dev` remains disabled.

Authenticated non-image attachments, if approved, use a separate
Worker-verifiable token path. They must not add authentication or hub callbacks
to durable image reads.

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

Access telemetry informs operations, abuse response, and cost projections. It
does not control durable image retention and cannot prove that no document
contains a copied URL.

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
- Authenticate and rate-limit uploads; enforce finite per-account publication
  allowances before accepting durable images.
- Treat reads as anonymous public traffic governed by site-wide Worker,
  cache-miss, R2-operation, and projected-cost budgets.
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

These tiers determine migration order, not image lifetime or final inclusion.
Unknown external notebook/document references make inactivity insufficient
evidence for exclusion.

- **Tier 0:** UUIDs from active support cases and known broken migrated
  documents.
- **Tier 1:** approved images referenced in scans of already migrated/restored
  notebooks, chats, project files, support records, or public content,
  regardless of age.
- **Tier 2:** approved images created or accessed on/after the explicitly
  approved cutoff, initially proposed as two years before legacy shutdown.
- **Tier 3:** approved images associated with migrated accounts/projects,
  subject to measured count/bytes and confidence in the association.
- **Tier 4:** every remaining recoverable approved safe raster image, migrated
  after higher-confidence/high-demand tiers.

Before bulk migration, publish counts, canonical/source bytes, source split,
format split, rejection counts, estimated cost/duration, and
missing/conflicting source counts for every tier. If inventory makes Tier 4
operationally infeasible, reducing its scope requires an explicit product
decision that acknowledges some old external image URLs will remain broken.

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

Every migrated, verified safe raster image receives a
`durable-public-image` compatibility handle. Its legacy URL remains readable
without authentication and survives originating account/project deletion.
This preserves notebooks and external copies whose full occurrence graph is
unknowable.

Only policy-selected and byte-verified images are published. The migration
does not make all 23.7 million legacy rows public: archived syncstrings,
non-images, malformed content, and unselected cold rows remain absent.

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
2. Byte-classify every current row. Backfill safe raster images as
   `durable-public-image`; keep non-images on a separately reviewed policy.
3. Create one compatibility handle and `current-uuid` alias per current row,
   preserving existing account/project fields as attribution evidence.
4. Mirror canonical bytes to a private staging R2 bucket and verify every
   SHA-256, size, media type, and read response.
5. Update all upload producers to create random handles even on content dedup.
6. Update all active consumers in the enumerated inventory to accept new
   handle URLs and compatibility aliases.
7. Deploy durable-public-image and separately scoped authenticated attachment
   Worker paths and compare with PostgreSQL mode.
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
- Treat durable handles/aliases as permanent liveness roots, not discovered
  document occurrences or originating account/project state.
- Account/project deletion nulls or anonymizes provenance and does not remove
  durable handles, aliases, or objects.
- Garbage-collect only objects with no durable handles/aliases and no other
  active handle, after a long grace period and a second transactional check.
- Purge edge cache for exceptional legal/privacy/security/abuse removal or
  handle disablement.
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
- durable-image upload quota rejections and site-wide read-budget actions;
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
  anonymously, including after the source account and project are deleted.
- Duplicate upload creates two handles and one object.
- Logical quota is charged per approved handle policy despite deduplication.
- Chat import rebinds/re-uploads bundled assets.
- Jupyter Markdown pasted images use global handles.
- Pasting an image does not insert base64 bytes into live notebook sync state or
  TimeTravel patches.
- Copying raw Jupyter Markdown between cells, notebooks, projects, chat, tasks,
  and Markdown files preserves a working durable global URL.
- Every ordinary Jupyter save embeds each eligible CoCalc image in the
  appropriate cell's native attachments without mutating the live notebook.
- Save handles duplicate local names, repeated images, multiple cells, legacy
  aliases, and existing native attachments while preserving exact MIME.
- Save never fetches an arbitrary external URL and atomically preserves the
  previous `.ipynb` if a required authored image cannot be resolved.
- Reloading an unchanged CoCalc-saved notebook reuses its metadata-recorded
  handles and does not consume quota or create duplicate handles.
- Importing an external native attachment creates one handle, records its
  mapping on save, and preserves all supported MIME variants.
- File, course, and cross-project copies of the saved `.ipynb` remain
  self-contained in stock Jupyter, GitHub, and Colab.
- Jupyter execution outputs remain in project-scoped AKV and are unaffected.
- Support, theme, news, public-share, course, task, git, chat, export, import,
  ACP materialization, and generated-image paths are covered explicitly.

### Storage and access

- PostgreSQL and R2 object-store contract tests.
- No-Cloudflare deployment with no Worker/R2 settings.
- Pending object or handle is never readable.
- Random handle does not reveal SHA-256 or deterministic object key.
- Durable-public-image works anonymously within site budgets.
- Account/project deletion anonymizes provenance without changing image bytes,
  aliases, handles, or HTTP responses.
- Authenticated non-image attachments, if implemented, remain a separate token
  and retention path.
- Exceptionally disabled handles stop resolving and trigger cache purge.
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
- Durable upload quota and anonymous site-wide read budget exhaustion.
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
- Add transparent Jupyter live-global-link/on-disk-native-attachment
  serialization without changing live cross-editor link behavior.

Gate: application semantics and PostgreSQL-only tests pass with no Cloudflare
configuration.

### Phase 2: Private R2 staging canary

- Provision private staging bucket, Worker, signing keys, telemetry, budgets,
  and circuit breaker.
- Mirror and exhaustively verify staging/current objects.
- Test durable public images, separately scoped authenticated attachments,
  transparent Jupyter save/load conversion, failure injection, and abuse.

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
- Run Tier 4 to complete every recoverable validated safe raster image.
- Continuously reconcile source, manifest, object, handle, alias, and reads.

Gate: the selected manifest is fully accounted for as available or a documented
terminal evidence state.

### Phase 7: Tail and source-retention decision

- Observe authenticated migration-priority misses and support demand.
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

1. Worker handle/alias resolution and cache-invalidation mechanism that avoids
   a hub/database lookup on warm durable image reads.
2. Exact per-account/project durable-publication count, byte, rate, decoded
   size, and pixel-dimension limits.
3. Logical publication charging per handle and attribution split between
   account and project.
4. Whether inventory justifies any residual legacy image cutoff. Recommended
   default: no cutoff after archived-syncstring exclusion and safe-raster
   validation, since unknown external references cannot be inventoried.
5. Exact safe raster allowlist and validation library; SVG remains excluded by
   default.
6. Authorization, tombstone retention, and grace period for exceptional
   legal/privacy/security/abuse removal and zero-handle objects.
7. Whether managed production needs an EU jurisdiction realm now.
8. How long current PostgreSQL rollback bytes remain after R2 cutover.
9. Whether to operate the temporary signed-in legacy fallback gateway.
10. Whether R2 canonical objects need independent replication/backup.
11. Long-term retention of cold/non-image legacy sources.
12. Whether approximate counts plus monotonic last-active day are sufficient.
13. Versioned CoCalc cell-metadata schema for mapping serialized native
    attachment names/content identities back to durable handles, including
    behavior when metadata is stripped, stale, disabled, or mismatched.

## Recommended First Implementation Slice

Do not start with 23.7 million legacy rows. Implement:

1. object/handle/alias schema and PostgreSQL object store;
2. random-handle uploads and correct duplicate attribution/quota;
3. compatibility aliases for the small current corpus;
4. durable-public-image reads across every enumerated image use case, with
   non-image/confidential attachments kept separate;
5. Cloudflare immediate denial-of-wallet mitigation;
6. private staging R2 object store and Worker;
7. transparent Jupyter live-link/on-disk-attachment conversion that leaves the
   live collaborative notebook unchanged and preserves cross-editor copy;
8. exhaustive migration/verification of current staging and production blobs;
9. archived-syncstring exclusion inventory and creation shutdown; and
10. a Tier 0 legacy safe-raster pilot.

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
- `src/packages/frontend/jupyter/cell-input.tsx`
- `src/packages/jupyter/redux/actions.ts`
- `src/packages/jupyter/redux/project-actions.ts`
- `src/packages/jupyter/ipynb/import-from-ipynb.ts`
- `src/packages/jupyter/ipynb/export-to-ipynb.ts`
- `src/packages/jupyter/ipynb/export-import.test.ts`
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

## Relevant External References

- Jupyter notebook cell attachments:
  https://nbformat.readthedocs.io/en/5.2.0/format_description.html#cell-attachments
- GitHub attaching files and anonymized asset URLs:
  https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/attaching-files
- GitHub relative image links for repository-contained assets:
  https://docs.github.com/en/get-started/writing-on-github/getting-started-with-writing-and-formatting-on-github/basic-writing-and-formatting-syntax#images

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
