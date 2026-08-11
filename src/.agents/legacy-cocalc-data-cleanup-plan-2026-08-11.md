# Legacy CoCalc.com Data Cleanup Plan

Date: 2026-08-11

Status: operational plan. No deletion has been performed by this document.

## Goal

Reduce ongoing costs from old `cocalc.com` infrastructure after the July 2026
shutdown and project archive migration, while keeping the remaining blob
migration work separate and recoverable.

The near-term deletion targets are old project archive/storage buckets and
obsolete VM disks. The old legacy blob sources are not deletion targets yet.

## Current Cost Signal

Input: August 2026 billing CSV uploaded under `/home/user/scratch`.

The report appears to contain mainly the first 10 days of August. The SKU-level
Cloud Storage subtotal is 266.95 USD for the report window.

Dominant storage SKUs:

| SKU                              |               Usage | Report subtotal |
| -------------------------------- | ------------------: | --------------: |
| Nearline Storage South Carolina  | 16,554.76 GiB-month |      165.55 USD |
| Coldline Storage South Carolina  | 22,203.67 GiB-month |       88.81 USD |
| Nearline Storage US Multi-region |    597.18 GiB-month |        8.96 USD |
| Archive Storage US Multi-region  |    952.79 GiB-month |        2.29 USD |

The two South Carolina SKUs almost certainly correspond to:

- `kucalc-prod2-archived-projects` - Nearline, us-east1
- `kucalc-prod2-storage-streams` - Coldline, us-east1

Assuming this is approximately 10 days of a 31-day month:

- South Carolina Nearline monthly equivalent: about 513 USD/month.
- South Carolina Coldline monthly equivalent: about 275 USD/month.
- Combined old project bucket monthly equivalent: about 790 USD/month.
- Implied stored size: roughly 50 TiB Nearline plus 67 TiB Coldline, about 117 TiB total.

If the report window is closer to 11 days, the combined monthly equivalent is
about 715 USD/month. The correct conclusion is not sensitive to that ambiguity:
the old project buckets are burning roughly 25 USD/day.

Other visible report costs:

- Compute Engine subtotal: 56.79 USD in the report window, roughly
  160-180 USD/month if the same pattern continues.
- Persistent disk SKU shown in the CSV is small, but disk inventory still needs
  a separate check because stopped VMs can retain large disks.

## Retention Decision

Recommended decision:

1. Delete `kucalc-prod2-storage-streams`.
2. Delete `kucalc-prod2-archived-projects`.
3. Keep the old blob sources until the R2 blob plan reaches its own cleanup
   gate:
   - old `smc-blobs` bucket;
   - old database VM/disk or a verified export sufficient to recover blob
     bytes and metadata.

Rationale:

- Millions of projects were migrated to R2 over a month ago.
- Successful restores have been observed.
- There are no known reports of failed restores or missing project data.
- The remaining unsolved legacy blob work does not require these old project
  archive buckets.

## Preconditions Before Bucket Deletion

Before applying deletion:

1. Confirm the old project migration manifests and R2 repositories are still
   available and independently backed up.
2. Confirm no restore worker, cron job, or operator script still reads either
   old bucket.
3. Snapshot current bucket metadata:

```sh
gcloud storage buckets describe gs://kucalc-prod2-storage-streams --format=json \
  > /tmp/kucalc-prod2-storage-streams.bucket.json

gcloud storage buckets describe gs://kucalc-prod2-archived-projects --format=json \
  > /tmp/kucalc-prod2-archived-projects.bucket.json
```

4. Save current billing evidence and this deletion approval note in a durable
   operator folder.
5. If a fresh exact size is required, prefer Cloud Monitoring bucket metrics
   over `gcloud storage du` because `du` lists objects and can be slow for huge
   buckets. If `du` is used, include noncurrent versions:

```sh
gcloud storage du --summarize --readable-sizes --all-versions \
  gs://kucalc-prod2-storage-streams

gcloud storage du --summarize --readable-sizes --all-versions \
  gs://kucalc-prod2-archived-projects
```

6. Verify and update `gcloud` auth. The current local config was observed to
   fail refreshing `cocalc-rocket-bootstrap@projecthosts.iam.gserviceaccount.com`.

## Efficient GCS Bucket Deletion Strategy

Do not delete millions of objects from a local shell loop.

Preferred strategy:

1. Disable Object Versioning so no new noncurrent versions are created.
2. Disable or minimize Soft Delete before deleting live objects, if policy
   permits. Existing soft-deleted objects are not affected by clearing the
   setting.
3. Install an Object Lifecycle Management rule with `Age=0` and `Delete`, so
   Cloud Storage performs server-side asynchronous bulk deletion.
4. Monitor bucket object count and bytes until live and noncurrent bytes fall.
5. Delete the now-empty bucket after lifecycle deletion completes and retention
   windows expire.

Example lifecycle file:

```json
{
  "rule": [
    {
      "action": { "type": "Delete" },
      "condition": { "age": 0 }
    }
  ]
}
```

Example commands:

```sh
gcloud storage buckets update gs://kucalc-prod2-storage-streams \
  --no-versioning \
  --clear-soft-delete \
  --lifecycle-file=/tmp/delete-all-objects-lifecycle.json

gcloud storage buckets update gs://kucalc-prod2-archived-projects \
  --no-versioning \
  --clear-soft-delete \
  --lifecycle-file=/tmp/delete-all-objects-lifecycle.json
```

If retention policies or holds are configured, clear only unlocked policies
after inspection. Do not use `--lock-retention-period`.

Important billing caveats:

- Soft-deleted objects can remain billable until their retention duration ends.
- Existing soft-deleted objects are not removed by `--clear-soft-delete`.
- Object Versioning can retain noncurrent versions; include noncurrent bytes in
  size checks.
- Nearline and Coldline can have early deletion charges, but this data is old
  enough that ordinary minimum-storage-duration charges should not dominate.

## VM Disk Cleanup

Inventory before deleting:

```sh
gcloud compute instances list
gcloud compute disks list --sort-by=~sizeGb
gcloud compute snapshots list --sort-by=~creationTimestamp
```

Recommended policy:

1. Keep exactly the VM/disk needed for legacy blob work until R2 blob migration
   reaches its cleanup gate.
2. Delete stopped VMs that are not needed for blob recovery.
3. Delete unattached disks after a final snapshot only if they might contain
   unique operational data.
4. Delete old snapshots after the corresponding disks are intentionally gone
   and a short verification window passes.

## Blob R2 Implementation Plan

Do not tie old project bucket deletion to legacy blob migration. The old
project buckets can go first.

For blobs, follow the existing plan in
`legacy-blob-r2-storage-and-migration-plan-2026-07-18.md`, but implement in
small deployable slices:

### Phase A: no-behavior-change storage abstraction

- Add a `BlobByteStore` interface under `@cocalc/server/blobs`.
- Add a PostgreSQL implementation that delegates to existing `db().save_blob`
  and `db().get_blob`.
- Route `saveBlobToDatabase` and `readBlobFromDatabase` through the interface
  while keeping behavior unchanged.
- Add tests for UUID validation, idempotent save, and read missing/existing.

Gate: all current blob tests pass and no deployment configuration changes.

### Phase B: R2 object layout and backend

- Add deterministic key layout:
  `blobs/v1/<first-two-uuid-hex>/<uuid>`.
- Add R2 implementation using `@cocalc/backend/r2`.
- Store exact uncompressed bytes.
- Store trusted metadata:
  `sha256`, `size`, `content-type`, `source`, `version`, `created-at`.
- Implement `head`, `get`, and conditional immutable `put`.

Gate: focused tests with a mocked R2 request layer verify collision handling
and idempotent duplicate writes.

### Phase C: managed-site configuration

- Add explicit backend setting:
  `blob_storage_backend = auto | postgres | r2`.
- Add blob-specific R2 bucket/host settings rather than overloading backup
  bucket semantics:
  - blob bucket prefix or full bucket name;
  - canonical public blob host;
  - read Worker health URL;
  - write credential selection.
- Use `secret-setting-input.tsx` for any admin secret UI.
- `auto` must choose R2 only when configuration and health checks are complete
  before writes begin.

Gate: partial R2 config fails closed to PostgreSQL or refuses R2 startup; it
must never silently split writes.

### Phase D: public read Worker

- Implement a small Worker outside the hub data path.
- Accept only canonical UUID GET/HEAD.
- Validate UUID before R2 access.
- Return immutable cache headers and `nosniff`.
- Reject listing, metadata, and arbitrary key proxy behavior.
- Keep `/blobs/<filename>?uuid=<uuid>` as compatibility redirect or hub route
  during transition.

Gate: staging proves cold/warm read behavior and malformed request behavior.

### Phase E: dual-write and current corpus

- Dual-write current production uploads to PostgreSQL and R2.
- Backfill the small current production corpus.
- Verify bytes and UUIDs.
- Switch public reads to Worker/R2 only after verified copies exist.
- Keep PostgreSQL bytea for rollback until a separate cleanup decision.

### Phase F: legacy blob migration

- Inventory legacy database rows and exact archived-syncstring exclusions.
- Reconcile `smc-blobs` GCS pointers.
- Migrate only verified safe raster images.
- Record a resumable manifest outside the serving path.
- Keep old blob sources read-only until support cases and random verification
  pass explicit thresholds.

## Immediate Next Actions

1. Re-authenticate `gcloud` with an account that can inspect and modify the old
   buckets.
2. Save bucket metadata and lifecycle/soft-delete/versioning state.
3. Make a written operator decision to delete the two old project buckets.
4. Apply server-side lifecycle delete rules with `Age=0`.
5. Monitor billing and bucket metrics daily until the storage SKUs disappear or
   reduce to soft-delete retention tail.
6. Start Phase A of the blob R2 implementation in code.

## References

- Google Cloud Storage object deletion overview:
  https://docs.cloud.google.com/storage/docs/object-deletion-overview
- Google Cloud Storage delete objects:
  https://docs.cloud.google.com/storage/docs/deleting-objects
- Google Cloud Storage soft delete:
  https://docs.cloud.google.com/storage/docs/soft-delete
- Google Cloud Storage lifecycle management:
  https://docs.cloud.google.com/storage/docs/lifecycle
- Google Cloud Storage pricing:
  https://cloud.google.com/storage/pricing
- Cloudflare R2 pricing:
  https://developers.cloudflare.com/r2/pricing/
