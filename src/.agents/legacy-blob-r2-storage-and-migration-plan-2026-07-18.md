# Legacy Blob Storage and Migration Plan

Date: 2026-07-18

Status: proposed implementation plan. No legacy blob data has been migrated by
this document.

This plan covers both the long-term CoCalc blob architecture and recovery of
legacy `cocalc.com/blobs/...?...uuid=...` links. The immediate problem is that
those URLs now redirect to `cocalc.ai`, but most legacy UUIDs are absent from
the new database and return "blob not found."

The plan deliberately supports two deployment classes:

- CoCalc deployments without Cloudflare, including CoCalc Plus and CoCalc
  Star, continue to store blob bytes in PostgreSQL. This is a supported and
  appropriately simple configuration, not a degraded fallback.
- Cloudflare-enabled managed deployments store blob bytes in private R2 and
  serve them through a Worker. PostgreSQL stores metadata and references, not
  the object bytes.

The public URL and application APIs must behave the same in both modes.

## Executive Decision

Implement a deployment-selectable `BlobStore` before migrating legacy data.

1. Preserve PostgreSQL as the default backend when Cloudflare/R2 is not fully
   configured.
2. In a Cloudflare-enabled deployment, write immutable blob objects to a
   private R2 bucket and serve `/blobs/...?...uuid=...` through a Worker with an
   R2 binding.
3. Keep the existing public capability-URL behavior. Blob GETs have
   historically been unauthenticated; changing that would break existing
   documents, chats, and migrated files.
4. Keep content bytes separate from references. One content-addressed blob may
   be referenced by many accounts and projects in different bays.
5. Do not update PostgreSQL synchronously for every GET. Emit access events
   asynchronously and aggregate them into coarse `last_active` and count data.
6. Migrate the small current production corpus first, then inventory the
   legacy PostgreSQL/GCS corpus, then migrate policy-selected legacy blobs.
7. Keep the old database disk and GCS bucket immutable until the migration has
   been independently verified and a separate retention decision is approved.

Do not import millions of legacy bytea values into the cocalc.ai production
database.

## Verified Current State

### Current cocalc.ai implementation

The current implementation is still the legacy PostgreSQL/GCS design:

- `src/packages/util/db-schema/blobs.ts` defines a global `blobs` table with
  `blob bytea`, `gcloud`, `compress`, `project_id`, `account_id`,
  `last_active`, `count`, and `size`.
- `src/packages/database/postgres/blobs/methods-impl.ts` writes new bytes to
  PostgreSQL. A maintenance path can move bytes to a mounted GCS blob store,
  set `gcloud`, and clear `blob`, but this is not an R2 implementation.
- `src/packages/hub/servers/app/blobs.ts` publicly serves `/blobs/...` through
  the hub, updates access metadata, and redirects non-seed bays to the seed
  bay.
- `src/packages/hub/servers/app/blob-upload.ts` and
  `src/packages/server/blobs/save.ts` route all current writes to the cluster
  seed bay. In production this means bay 0 is the blob authority and data
  plane.
- The user-facing upload limit is currently 25 MB.
- The public route treats the UUID as a capability. It allows safe image
  extensions inline, forces other extensions to download, sets `nosniff`, and
  uses a long public cache lifetime.
- TimeTravel/archive blob RPCs have separate authorization checks and must not
  accidentally become public through this migration.

A read-only production query on 2026-07-18 found:

- 568 current blob rows.
- 568 rows still containing PostgreSQL bytea.
- 0 rows with a `gcloud` marker.
- 135,067,194 total logical/blob bytes, about 135 MB.
- 0 rows missing both PostgreSQL bytes and a cloud marker.

This is small enough to migrate and verify exhaustively before touching the
legacy corpus.

### Legacy cocalc.com implementation

The source under `/home/user/upstream/cocalc` confirms the same basic model:

- Metadata and recently used bytes lived in PostgreSQL.
- A maintenance task copied colder bytes to the `smc-blobs` GCS bucket and
  normally cleared the PostgreSQL bytea after verification.
- A row with `blob IS NULL` and `gcloud IS NOT NULL` was read from GCS,
  decompressed according to `compress`, and served by the hub.
- Reads incremented `count` and updated `last_active` in PostgreSQL.
- Public `/blobs` GETs were unauthenticated capability URLs.
- `project_id` and later `account_id` were recorded, but they are not a
  complete many-to-many reference graph. Content deduplication means one row
  can represent bytes used from more than one document, project, or account.

The final shutdown inventory in
`/home/user/kucalc/cluster2/notes/2026-shutdown.md` records 23,715,443 legacy
blob rows. The read-only archive database is currently available on its
preserved VM, and the old GCS bucket is preserved.

### Existing R2 implementation

CoCalc already has reusable R2/S3 primitives in
`src/packages/backend/r2.ts` and `src/packages/server/project-backup/r2.ts`, plus
bucket records in `src/packages/util/db-schema/buckets.ts`. Project backups
already create buckets using Cloudflare location hints such as `wnam`, `enam`,
and `weur`.

Those labels are location hints, not residency guarantees. Cloudflare states
that hints are best effort. Jurisdictions, currently including `eu`, are the
mechanism that guarantees a residency boundary. Blob design must not treat a
project-host region or an R2 location hint as a legal residency guarantee.

## Goals

- Make every recoverable selected legacy blob URL work at its existing URL.
- Keep large blob bytes out of managed PostgreSQL when Cloudflare is enabled.
- Keep PostgreSQL-only deployments simple and fully functional.
- Remove the hub from the steady-state managed blob download data plane.
- Preserve current public-link, cache, download, and security behavior.
- Support range and conditional requests.
- Maintain enough access information to make retention decisions without a
  write to PostgreSQL for every request.
- Make migration idempotent, resumable, auditable, and safe to rerun.
- Give support a UUID lookup that explains source, migration state,
  references, errors, and the next recovery action.
- Keep multibay authority explicit.

## Non-goals

- Do not recover legacy TimeTravel history as part of public blob migration.
- Do not make the old read-only database a permanent production dependency.
- Do not make an R2 bucket or `r2.dev` endpoint publicly listable.
- Do not infer data residency from the host currently running a project.
- Do not delete old GCS objects or the old database after initial success.
- Do not require Cloudflare, Workers, or R2 for CoCalc Plus/Star.

## Required Invariants

1. A blob UUID always identifies the same uncompressed bytes.
2. Existing UUID URLs remain valid; the filename portion is presentation, not
   object identity.
3. A successful write is not visible until its bytes and metadata are both in
   an `available` state.
4. A missing telemetry event must never fail a blob read.
5. A duplicate upload must add its new account/project reference even if the
   content object already exists.
6. Deleting one reference must not delete bytes still referenced elsewhere.
7. Object deletion requires a grace period, a zero-reference check, and an
   audit record.
8. R2 mode must fail closed for writes if its configuration is incomplete. It
   must not silently split new writes between PostgreSQL and R2.
9. PostgreSQL mode must not require Cloudflare settings or Worker deployment.
10. Legacy source bytes remain read-only throughout migration.

## Deployment Modes and Configuration

Add a site setting with explicit values:

```text
blob_storage_backend = auto | postgres | r2
```

Recommended behavior:

- `postgres`: PostgreSQL bytea is canonical. The hub serves `/blobs`. This is
  the default for non-Cloudflare deployments.
- `r2`: private R2 bytes plus Worker delivery are canonical. Startup/readiness
  fails if dedicated blob bucket, credentials, Worker route, or health checks
  are missing.
- `auto`: select `r2` only when `cloudflare_mode=self` and the complete blob R2
  configuration is provisioned and healthy; otherwise select `postgres`.

Do not infer R2 readiness merely from project-backup credentials. Add
purpose-specific settings or bucket records for blobs, for example:

```text
blob_r2_bucket
blob_r2_jurisdiction       # empty/global or eu
blob_worker_hostname
blob_access_queue
```

Secrets may reuse account-level R2 credentials where operationally sensible,
but the blob bucket and its least-privilege token must be distinct from project
backups. The admin UI should show the resolved backend and a health test.

The selected backend is deployment-wide during the first implementation. Do
not allow individual bays to choose different backends accidentally.

## Target Storage Abstraction

Introduce a small server-side interface and keep all callers on the existing
high-level blob APIs:

```ts
interface BlobStore {
  put(input: PutBlob): Promise<StoredBlob>;
  head(id: string): Promise<BlobHead | undefined>;
  get(id: string, options?: BlobGetOptions): Promise<BlobBody | undefined>;
  delete(id: string): Promise<void>;
  health(): Promise<BlobStoreHealth>;
}
```

Implementations:

- `PostgresBlobStore`: wraps the current database behavior. It remains the
  production implementation for non-Cloudflare deployments.
- `R2BlobStore`: uses existing `@cocalc/backend/r2` primitives for control
  plane writes, verification, and administrative reads. Public GETs use the
  Worker binding, not S3 credentials in the browser.

Keep authorization and reference creation above `BlobStore`. Storage backends
must not decide whether an account is a project collaborator.

## Object Identity and R2 Layout

Use the existing UUID as the public identity and a deterministic object key:

```text
blobs/v1/<first-two-hex>/<next-two-hex>/<uuid>
```

Do not include a user filename, project ID, account ID, or bay ID in the object
key. The same immutable bytes can be shared safely, filenames do not duplicate
storage, and a Worker can compute the key without querying PostgreSQL.

Store canonical uncompressed bytes in R2. Legacy `compress` describes storage
compression in the old system, not an HTTP `Content-Encoding`; migration must
decompress before upload.

Record custom object metadata:

- public UUID
- SHA-256 of canonical bytes
- canonical byte size
- migration/source version
- creation timestamp

The UUID is derived from SHA-1 for compatibility. SHA-1 is not sufficient for
new adversarial integrity checks. Calculate SHA-256 for every new and migrated
object. If an existing UUID has a different size or SHA-256, quarantine both
inputs and raise a critical alert instead of overwriting.

Use one private global managed blob bucket initially. R2 location hints are
performance hints, and an object can have multiple project/account references
in multiple regions. Splitting by project host region would require a global
UUID-to-bucket routing lookup on every GET and would make shared blobs
ambiguous.

### Expected performance of one global bucket

This should not materially hurt normal blob-read performance:

- The Worker and cache run near the viewer. Repeated reads are served from
  Cloudflare's edge rather than the R2 object location.
- Object location mainly affects upload latency and the first uncached read in
  a geography.
- Current blobs are limited to 25 MB and most are much smaller.
- A project's compute-host region is not necessarily the location of the user
  viewing a blob, so project placement is a weak read-locality signal.
- Avoiding a UUID-to-region directory removes a database/KV lookup from every
  public GET and reduces both latency and another global availability
  dependency.

This is an expectation to test, not an assumption to hide. Before production
cutover, measure cold and warm p50/p95/p99 time-to-first-byte and total download
time from at least western/eastern North America, western/eastern Europe,
Asia-Pacific, and Oceania. Test representative 10 KB, 1 MB, 10 MB, and 25 MB
objects. The initial acceptance target should be no meaningful regression for
warm reads and a documented cold-read budget by geography.

If cold-read latency is materially worse, first enable/tune Cloudflare tiered
cache. Only then consider deterministic replication to a small number of
storage realms. Do not introduce per-project bucket routing unless measurements
show that cache and tiering are insufficient.

If a contractual residency requirement exists, add an explicit storage realm:

- `global`
- `eu`

An EU realm must use an R2 EU jurisdiction bucket, not merely a `weur` or `eeur`
hint. The same content may need one physical object per realm. This should be a
separate phase after the global path is stable.

## Metadata and Reference Model

Use the existing seed-global `blobs` table as the compatibility content
registry initially, but stop overloading `gcloud` for new R2 state. Add explicit
fields or a one-to-one `blob_objects` table:

```text
id                    uuid primary key
storage_backend       postgres | r2
storage_realm         global | eu | null
storage_bucket        text null
storage_key           text null
storage_state         pending | available | quarantined | deleting | missing
size                  bigint
sha256                text null
created               timestamptz
verified_at           timestamptz null
last_active           timestamptz null
access_count          bigint
source                current | legacy-db | legacy-gcs | legacy-support
source_metadata       jsonb
```

Create a separate reference table:

```text
blob_references
  blob_id
  reference_id
  scope_type           account | project | public | system
  account_id           uuid null
  project_id           uuid null
  owning_bay_id        uuid null
  purpose              upload | chat | paste | support | legacy | syncstring
  created
  expires              timestamptz null
  deleted_at           timestamptz null
```

Enforce one active logical reference per application object, not merely one per
blob/account pair. A user may intentionally attach the same bytes twice.

The content registry is a documented seed-global exception because public UUID
resolution is global. Reference mutations are authorized by the authoritative
owner:

- Project reference: the project's `owning_bay_id` authorizes it.
- Account reference: the account's `home_bay_id` authorizes it.
- Legacy/public reference: the seed migration service authorizes it.

Cross-bay calls must use the existing inter-bay routing layer. A bay must not
write directly to another bay's project/account state.

Update `table-ownership.ts`; the current declaration that the whole `blobs`
table is simply project-owned does not describe actual account-only, public,
deduplicated, or seed-global behavior.

### Quotas

Separate physical storage from logical usage:

- Physical bytes are counted once per R2 object/realm.
- Account/project quota is charged from active logical references according to
  an explicit product policy.
- A duplicate content upload still creates a reference and is visible to quota
  and deletion logic.

Do not preserve the current accidental behavior where finding an existing UUID
can return before adding the new ownership/reference information.

## Request Flows

### PostgreSQL mode

The current flow remains:

1. Authenticate and authorize upload at the hub/bay.
2. Validate size and UUID against bytes.
3. Store canonical bytes and metadata in PostgreSQL.
4. Serve public GET/HEAD through the hub route.
5. Update `last_active` and count in PostgreSQL.

This path should share response-header and filename-policy helpers with the
Worker implementation so modes do not diverge.

### R2 upload flow

Use two rollout stages.

Stage A, lowest-risk implementation:

1. Client uploads through the existing authenticated hub endpoint.
2. The authoritative bay validates permission, size, and the UUID.
3. The server computes SHA-256 while streaming/spooling the upload.
4. The seed blob service writes a temporary R2 key.
5. It verifies R2 HEAD metadata and, during initial rollout, reads back and
   hashes the object.
6. It commits metadata/reference state as `available` and promotes or writes
   the deterministic immutable key.

Stage B, after correctness is proven:

1. Client asks the authoritative bay to begin an upload.
2. The bay creates a pending upload and returns a short-lived presigned PUT URL
   for exactly one temporary key.
3. The browser uploads directly to the R2 S3 endpoint.
4. Client calls finalize.
5. Server verifies size, expected UUID/SHA-256, and R2 metadata before marking
   it available.

Cloudflare presigned URLs work only on the S3 API domain, not a custom domain.
Treat them as bearer credentials, constrain key, method, content type/length
where possible, keep expiry short, and configure CORS narrowly.

Do not begin with direct browser upload. The current corpus and 25 MB limit are
small enough that Stage A gives a much safer first cutover.

### R2 public read flow

Route only `GET` and `HEAD` for `/blobs/*` to a dedicated Worker. Keep the R2
bucket private and disable `r2.dev` public access.

Worker behavior:

1. Parse and strictly validate the UUID query parameter.
2. Normalize the R2 key from UUID; never concatenate the filename into a key.
3. Apply conditional and range headers to the R2 binding.
4. Stream the body without buffering it in Worker memory.
5. Preserve ETag, range, and content length semantics.
6. Apply the same inline/download rules as the hub. Only known safe image
   content may be inline; all other content is attachment.
7. Set `X-Content-Type-Options: nosniff` and an explicit content security
   policy where applicable.
8. Set immutable cache headers only after the object is available.
9. Emit telemetry using `waitUntil`; telemetry failure does not affect the
   response.
10. Return a non-cacheable miss during migration unless negative caching is
    deliberately configured. Cloudflare can cache 404s, so a newly migrated
    blob otherwise may continue to appear missing.

Use the Worker Cache API or a Worker route in front of the private binding, not
a directly public bucket custom domain. The Worker is required for compatible
filenames, response headers, access telemetry, R2 realm routing, and future
on-demand migration.

During cutover the hub route remains a fallback for current PostgreSQL blobs.
The Worker may call a tightly authenticated internal origin only on an R2 miss;
it must never expose R2 or database credentials.

## Access Tracking

The old hub performed one PostgreSQL update on every blob request. Do not
recreate that write amplification.

Use two telemetry levels:

1. Workers Analytics Engine for request rate, latency, status, cache outcome,
   source, bytes, and sampled UUID diagnostics. Its current three-month
   retention makes it useful for operations, not authoritative retention
   policy.
2. A Cloudflare Queue for durable successful-access events. Queue delivery is
   at least once, so consumers must be idempotent.

The queue consumer should:

- coalesce duplicate UUIDs in each batch;
- write `last_active = GREATEST(last_active, event_time)`;
- use a deterministic event/day idempotency key;
- maintain exact or explicitly approximate counts;
- use a dead-letter queue and alert on lag/failures;
- batch updates through an authenticated seed-bay endpoint or write durable
  daily access manifests for a bay job to ingest;
- never block the GET path.

Start by emitting one event per successful public read and measure cost and
volume. If necessary, reduce events to one per UUID per day using idempotent
daily aggregation. Retention decisions only need a trustworthy coarse last
access date, not an exact real-time counter.

If production has the required Cloudflare plan, HTTP/Worker Logpush to a
dedicated R2 log bucket is a useful independent audit stream. It is not the
sole source because Logpush has no historical backfill after an outage.

## Legacy Inventory Before Migration

Do not choose the final two-year scope from row count alone. Produce immutable
inventory exports and compute both object count and bytes.

### PostgreSQL inventory

Export all 23,715,443 rows using keyset pagination, not OFFSET. Include:

- UUID
- `octet_length(blob)` without exporting bytea in the metadata pass
- whether PostgreSQL bytes exist
- `gcloud` object/path marker
- `compress`
- logical `size`
- `created`, `last_active`, and `count`
- `expire`
- `project_id` and `account_id`
- any backup/status fields

Write date-stamped compressed Parquet or TSV shards plus a manifest containing
row count, byte count, query, database snapshot identity, min/max UUID, and
per-shard SHA-256. Store a durable copy outside the old VM.

Compute these grouped totals:

- DB bytes only
- GCS marker only
- both DB bytes and GCS marker
- neither source
- compressed by codec
- expiring versus permanent
- created/accessed by month
- associated project/account/null
- candidate counts and bytes for 6 months, 1 year, 2 years, 3 years, and all

Use July 4, 2024 as the initial two-year activity cutoff relative to the legacy
shutdown, then record the exact chosen timestamp in the migration manifest.

### GCS inventory

Use a GCS Storage Inventory report or an equivalent checkpointed bucket
inventory, not millions of ad hoc list calls. Capture:

- object key
- size
- generation
- updated time
- storage class
- CRC32C and MD5 when available

Reconcile database `gcloud` markers against GCS inventory into:

- metadata and source object present
- metadata points to missing GCS object
- unreferenced GCS object
- duplicate generations
- size/checksum conflict

Do not assume the GCS key can be derived from UUID until the old implementation
and real rows prove that for every format generation.

### Reference inventory

Legacy `project_id`/`account_id` columns are useful but incomplete. Build
additional candidate sets from:

- UUID links found in already restored/migrated project files;
- UUID links in migrated chats, support requests, and database-backed docs;
- blobs associated with legacy projects/accounts that have migrated;
- explicit support cases;
- current requests observed at `cocalc.ai/blobs` misses;
- recent `last_active` or recent creation in the old database.

Store the reason each UUID was selected. A row can have multiple reasons.

## Legacy Selection Policy

Recommended priority tiers:

- Tier 0: active support cases and observed missing UUID requests.
- Tier 1: blobs explicitly referenced by already migrated project files,
  chats, or documents, regardless of age.
- Tier 2: blobs whose legacy row was created or accessed on/after the approved
  two-year cutoff.
- Tier 3: blobs associated with accounts/projects already migrated, subject to
  measured size and confidence in the association.
- Tier 4: remaining cold blobs retained only in the preserved legacy sources
  unless later policy expands migration.

Always include Tier 0 and Tier 1 regardless of `last_active`. Include newly
created blobs even if their access counter is zero. Exclude expiring/transient
rows only under a documented rule.

Do not include legacy syncstring/TimeTravel archival blobs in the public Worker
namespace merely because they share the table. They require separate
authorization and the project migration policy says legacy TimeTravel is not
recoverable through this flow.

Before approving Tier 2, publish:

- selected UUID count;
- canonical bytes to read and write;
- source split between DB and GCS;
- estimated R2 storage and request cost;
- estimated duration at tested concurrency;
- count of selected rows with missing/conflicting source data.

## Legacy Migration Pipeline

Build a durable job table and CLI/LRO, not a one-off shell pipeline.

Suggested states:

```text
selected -> reading -> decoded -> verified -> uploading -> available
         -> source_missing | integrity_failed | quarantined | retryable_failed
```

Each job records:

- UUID and selection reasons
- expected source location/generation
- source compression
- attempt count and lease owner
- source bytes and canonical bytes
- SHA-256
- R2 bucket/key/ETag
- timestamps for every transition
- structured error code and bounded error detail
- worker version and inventory version

Per-object algorithm:

1. Claim with a lease using `FOR UPDATE SKIP LOCKED` or the existing LRO job
   framework.
2. If the canonical R2 object exists, verify metadata and mark idempotently
   available.
3. Read PostgreSQL bytea when present; otherwise read the exact GCS generation
   identified by inventory.
4. Decode legacy `gzip`/`zlib` storage compression.
5. Verify the uncompressed bytes produce the expected legacy UUID.
6. Compute SHA-256 and canonical size.
7. Upload a temporary object or use a conditional create.
8. HEAD and initially read back/hash the object.
9. Publish the deterministic key and metadata as available.
10. Add legacy reference/source records and mark the job complete.

If both DB and GCS bytes exist, verify both on a sample and every conflicting
row. Define a deterministic preference only after comparison.

Never overwrite an existing deterministic key without matching UUID, size,
and SHA-256. Quarantine conflicts for manual review.

Bound concurrency independently for:

- old PostgreSQL reads;
- GCS reads;
- decompression/CPU;
- R2 writes;
- verification reads.

Start with a small canary and increase based on source VM load, GCS errors,
queue depth, R2 errors, and checksum throughput. The old database must remain
responsive for support investigations.

### On-demand recovery

Pre-migration is the primary user experience. It avoids broken images that
need a manual refresh.

During the transition, an R2 miss for a valid UUID may call a dedicated,
service-authenticated legacy source gateway. That gateway can read the old
catalog/database/GCS, stream the canonical bytes, and enqueue the UUID at Tier 0. Requirements:

- strict UUID-only lookup;
- no arbitrary object/path access;
- request coalescing per UUID;
- bounded concurrency and timeouts;
- negative-result caching with short TTL;
- audit logs and rate limits;
- no direct Worker connection to PostgreSQL;
- no permanent dependency on the legacy VM.

This fallback is optional and temporary. Do not put it on the critical path
until it has load and security tests. If it is absent, misses should generate a
support-visible priority job rather than silently disappearing.

## Current cocalc.ai Migration Before Legacy Data

The 568-object current corpus is the proving ground.

1. Deploy schema/reference changes with PostgreSQL behavior unchanged.
2. Backfill references where possible and flag ambiguous rows.
3. Mirror all current bytes to a staging R2 blob bucket.
4. Verify every UUID, size, and SHA-256 by reading back from R2.
5. Deploy the Worker on a canary hostname and compare every response with the
   hub, including headers, ranges, cache, bad UUIDs, and filenames.
6. Enable dual read in staging: R2 first, PostgreSQL fallback.
7. Enable dual write in staging and inject failures at every transition.
8. Repeat in production while PostgreSQL remains canonical.
9. Route a small percentage of production GETs to the Worker and compare
   status/body hashes.
10. Make R2 canonical only after all objects are mirrored and discrepancy is
    zero for a sustained window.
11. Retain PostgreSQL bytes for a rollback interval, then clear bytea in
    bounded batches after backups and final verification.

Because the current corpus is only about 135 MB, use exhaustive verification,
not sampling.

## URL and Redirect Compatibility

Keep these URLs working:

```text
https://cocalc.com/blobs/<display-name>?uuid=<uuid>
https://cocalc.ai/blobs/<display-name>?uuid=<uuid>
```

The first may continue redirecting to the second. The second must be the stable
canonical URL in both storage modes.

Test:

- filenames with spaces, Unicode, quotes, percent escapes, and no extension;
- UUID parameter order and unrelated query parameters;
- safe images inline;
- PDF, HTML, SVG, executable, and unknown content as attachment;
- `GET`, `HEAD`, single range, invalid range, and conditional requests;
- ETag and cache behavior;
- current, migrated legacy, missing, quarantined, and expiring blobs;
- cocalc.com redirect cache behavior.

The response content type should come from trusted stored/sniffed metadata plus
an allowlist, not solely from an attacker-controlled display filename.

## Retention, Deletion, and Backup

R2 durability is not a substitute for a deletion policy or independent
recovery evidence.

- Keep migrated legacy sources in the old GCS/database during rollout.
- Use an R2 bucket lock on migration manifests and audit records, not
  necessarily on all user blob objects, because a broad lock can prevent legal
  deletion.
- Disable accidental lifecycle deletion on canonical blob prefixes.
- Mark zero-reference objects as garbage candidates; delete only after a long
  grace period and a second reference check.
- Purge Cloudflare cache when a legal/security deletion must take effect
  promptly. Cached custom-domain objects can survive origin deletion until
  purge/TTL.
- Back up metadata/reference tables through normal bay/database backups.
- Periodically export an immutable object manifest with UUID, key, size,
  SHA-256, ETag, and state.
- Decide separately whether new R2 blob objects require replication or a
  second-provider backup. Record the accepted durability model explicitly.

In PostgreSQL mode, existing database backup/restore remains the byte backup.
The same metadata/reference and garbage-collection rules should still apply.

## Security and Abuse Controls

- Keep canonical buckets private; disable `r2.dev`.
- Use separate least-privilege credentials for control-plane writes.
- Never expose S3 secrets to browsers. Presigned upload URLs are short-lived
  bearer capabilities for one key and method.
- Validate content length before and after upload.
- Verify legacy UUID and SHA-256 before publication.
- Set `nosniff`, safe content disposition, and appropriate CSP.
- Add WAF/rate limits for hotlink or denial-of-wallet attacks.
- Do not return account/project association metadata from the public Worker.
- Redact credentials, signed URLs, and raw bytea from logs.
- Audit admin recovery, quarantine override, and deletion actions.
- Test SHA-1 UUID collision handling; never silently replace existing bytes.
- Keep protected TimeTravel/blob RPCs off the public namespace.

## Operations and Support Tooling

Add operator commands along these lines:

```text
cocalc blob backend status
cocalc blob verify <uuid>
cocalc blob migrate-current --dry-run
cocalc legacy-blob inventory --snapshot <name>
cocalc legacy-blob plan --cutoff 2024-07-04
cocalc legacy-blob migrate --tier 0 --concurrency <n>
cocalc legacy-blob retry <uuid>
cocalc legacy-blob lookup <uuid>
cocalc legacy-blob verify --manifest <name>
```

All mutation commands require fresh admin elevation. Every bulk command needs
`--dry-run`, bounded concurrency, checkpointing, structured JSON output, and a
resume token.

Admin/support lookup should show:

- current object state and backend;
- last successful access and approximate count;
- known account/project references without exposing them publicly;
- legacy DB/GCS source and exact generation;
- selection reasons and tier;
- migration attempts/errors;
- checksum verification;
- a button to prioritize recovery or retry a safe failed job.

## Metrics and Alerts

Publish dashboards and alerts for:

- Worker GET/HEAD rate, status, p50/p95/p99 latency, and bytes;
- cache hit/miss ratio;
- R2 not-found rate for known/current UUIDs;
- PostgreSQL fallback and legacy fallback rate;
- upload pending age and finalize failures;
- UUID/SHA-256 integrity failures;
- Queue depth, oldest event age, retry rate, and dead-letter count;
- migration selected/running/available/failed counts and bytes by source/tier;
- old DB/GCS read errors and source-missing counts;
- metadata available with object missing, and object present without metadata;
- storage/object/operation cost by month;
- PostgreSQL `blobs` table byte size during drain.

Critical alerts:

- current blob advertised as available but missing in canonical storage;
- checksum conflict for an existing UUID;
- Worker cannot read R2 while hub fallback is disabled;
- access queue lag exceeds the retention-accounting SLO;
- migration source disappearance or unexpected object-count decrease.

## Test Plan

### Unit and integration

- Shared UUID, filename, header, and disposition policy in both backends.
- PostgreSQL and R2 `BlobStore` contract tests.
- Duplicate upload creates a second reference but one physical object.
- Pending upload is never publicly visible.
- R2 failure before/after upload and before/after metadata commit.
- Retry is idempotent after every injected failure.
- Range and conditional request behavior.
- Queue duplicate/out-of-order events produce monotonic `last_active`.
- Reference deletion and delayed garbage collection.
- Legacy gzip/zlib decode and malformed compression.
- UUID mismatch, SHA-256 conflict, truncated GCS read, missing generation.
- PostgreSQL mode with no Cloudflare settings at all.
- `auto` mode cannot partially activate R2.

### Canary data

Create fixtures covering:

- DB-only legacy bytes;
- GCS-only legacy bytes;
- both sources identical;
- both sources conflicting;
- missing source;
- compressed/uncompressed;
- zero-byte and maximum-size;
- multiple account/project references;
- filename/content-type attacks;
- old and recent access timestamps.

### Load and failure testing

- Sustained public reads with realistic cache distribution.
- Burst hot UUID and many cold UUIDs.
- Worker/R2 outage with and without fallback.
- Queue disabled or delayed for hours, followed by replay.
- Migration at increasing concurrency while monitoring the old DB VM.
- Hub/bay restart during upload finalization and migration leases.
- Cache purge after deletion and after a previously cached 404.

## Rollout Phases and Gates

### Phase 0: Freeze and measure

- Confirm lifecycle, retention, versioning, and IAM on old GCS and R2 sources.
- Export final old DB/GCS inventories.
- Record production current-blob inventory.
- Make no deletion changes.

Gate: all sources are reproducibly inventoried and immutable enough for the
migration window.

### Phase 1: Backend abstraction and reference correctness

- Add backend setting, `BlobStore`, explicit R2 metadata, and references.
- Keep production resolved to PostgreSQL.
- Fix duplicate-reference/quota behavior.

Gate: existing tests plus new contract tests pass in PostgreSQL mode with no
Cloudflare configuration.

### Phase 2: R2 current-blob canary

- Provision a private staging blob bucket, Worker, Queue, and telemetry.
- Mirror and exhaustively verify staging/current objects.
- Exercise failure and load tests.

Gate: zero content/header discrepancies and successful rollback to PostgreSQL.

### Phase 3: Production current blobs

- Mirror all 568 current objects and verify every byte.
- Canary Worker reads, then R2-first reads with PostgreSQL fallback.
- Enable R2 writes, retain DB rollback bytes.

Gate: sustained zero integrity errors, acceptable latency/error/cost, healthy
telemetry queue, and tested rollback.

### Phase 4: Legacy inventory and policy approval

- Complete database/GCS/reference inventories.
- Calculate candidate counts/bytes/costs for every tier/cutoff.
- Approve the final selection and retention policy.

Gate: every selected UUID has an auditable reason and expected source state.

### Phase 5: Legacy pilot

- Migrate support cases, known broken links, and a stratified fixture/sample.
- Validate links in real migrated documents.
- Exercise support lookup and retry tools.

Gate: all recoverable pilot objects serve correctly, and failures are
classified rather than silently skipped.

### Phase 6: Tiered bulk migration

- Run Tier 0 and Tier 1 first.
- Run approved recent-access/creation tiers with bounded concurrency.
- Continuously reconcile manifest, R2, and metadata.

Gate: selected manifest is fully accounted for as available or an explicit
terminal evidence state.

### Phase 7: On-demand tail and source retirement decision

- Observe misses and support demand.
- Optionally enable the temporary legacy source gateway.
- Reassess cold tiers from actual demand.
- Make a separate, reviewed decision about old VM/GCS retention.

Gate: no source is deleted merely because the selected migration completed.

## Rollback Strategy

- Before R2 becomes canonical, rollback is a setting change to PostgreSQL.
- During R2-first reads, preserve PostgreSQL fallback and bytea.
- Worker route changes must be independently reversible without a hub deploy.
- R2 uploads are immutable; a bad rollout changes metadata/routing, not object
  contents.
- Legacy jobs are idempotent and do not mutate source data.
- Never clear current PostgreSQL bytea until the rollback interval and full
  verification pass.
- Never delete old legacy source data as part of an application deploy.

## Decisions Requiring Explicit Approval

1. Exact legacy cutoff after count/byte inventory. Proposed baseline: created
   or accessed since 2024-07-04, plus all reference/support tiers.
2. Whether logical quota charges each active reference or unique bytes per
   account/project.
3. Whether managed production needs an EU jurisdiction realm now.
4. How long current PostgreSQL rollback bytes remain after R2 cutover.
5. Whether to operate a temporary synchronous legacy fallback gateway.
6. Whether R2 canonical objects need independent replication/backup.
7. Long-term retention of Tier 4 cold legacy data and the preserved old
   database/GCS sources.
8. Whether exact access counts matter, or only monotonic last-access day plus
   approximate counts.

## Recommended First Implementation Slice

Do not start with the 23.7 million legacy rows. Implement this vertical slice:

1. `BlobStore` with PostgreSQL and R2 implementations.
2. Explicit backend selection with PostgreSQL as the no-Cloudflare default.
3. Private staging R2 bucket and Worker-compatible response policy.
4. Metadata/reference schema and duplicate-reference correctness.
5. Mirror all current staging/production blobs, then exhaustively verify the
   568-object production corpus without changing reads.
6. Worker canary for GET/HEAD/range/cache/security behavior.
7. Queue-based access aggregation.
8. Production R2-first reads with PostgreSQL fallback only after staging and
   canary gates pass.

Only then run the legacy inventory and approve the migration cutoff. This
sequence prevents a large migration from locking CoCalc into another temporary
storage architecture.

## Relevant Source and Platform References

Repository:

- `src/packages/util/db-schema/blobs.ts`
- `src/packages/database/postgres/blobs/methods-impl.ts`
- `src/packages/hub/servers/app/blobs.ts`
- `src/packages/hub/servers/app/blob-upload.ts`
- `src/packages/server/blobs/save.ts`
- `src/packages/server/conat/api/db.ts`
- `src/packages/server/membership/blob-limits.ts`
- `src/packages/util/db-schema/table-ownership.ts`
- `src/packages/backend/r2.ts`
- `src/packages/server/project-backup/r2.ts`
- `src/packages/util/db-schema/buckets.ts`
- `src/.agents/scalable-architecture.md`
- `src/.agents/legacy-project-migration-recovery-plan-2026-07-09.md`
- `/home/user/upstream/cocalc/src/packages/database/postgres/blobs.ts`
- `/home/user/upstream/cocalc/src/packages/database/postgres-blobs.coffee`
- `/home/user/kucalc/cluster2/notes/2026-shutdown.md`

Cloudflare documentation reviewed on 2026-07-18:

- R2 data location and jurisdictions:
  https://developers.cloudflare.com/r2/reference/data-location/
- R2 Workers API, ranges, and conditional requests:
  https://developers.cloudflare.com/r2/api/workers/workers-api-reference/
- R2 public buckets and custom domains:
  https://developers.cloudflare.com/r2/buckets/public-buckets/
- R2 cache consistency caveats:
  https://developers.cloudflare.com/r2/reference/consistency/
- R2 presigned URLs:
  https://developers.cloudflare.com/r2/api/s3/presigned-urls/
- Workers Analytics Engine limits and retention:
  https://developers.cloudflare.com/analytics/analytics-engine/limits/
- Cloudflare Queues batching and retries:
  https://developers.cloudflare.com/queues/configuration/batching-retries/
- Cloudflare Queues delivery guarantees:
  https://developers.cloudflare.com/queues/reference/delivery-guarantees/
- Logpush to R2:
  https://developers.cloudflare.com/logs/logpush/logpush-job/enable-destinations/r2/
- R2 bucket locks:
  https://developers.cloudflare.com/r2/buckets/bucket-locks/
- R2 pricing:
  https://developers.cloudflare.com/r2/pricing/
