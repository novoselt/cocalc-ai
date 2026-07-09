# Legacy Migration Scripts

## `archive_to_r2.py`

Converts a legacy CoCalc.com project archive tar from:

```text
gs://kucalc-prod2-archived-projects/default/project-<project_id>.tar
```

to the cocalc.ai restore object:

```text
r2:cocalc-projects/prod3/default/<project_id>.tar.zst
```

It first tries the archive's `bup/` repo. If bup is missing or fails, it extracts
the archive's `.lz4` ZFS streams, replays the latest chain into a throwaway
file-backed ZFS pool, and exports that filesystem instead.

Run it on a VM with `bup`, `lz4`, `zstd`, `rclone`, `zfsutils-linux`, and either
`gsutil` or `gcloud`.

Bootstrap a fresh Ubuntu VM with:

```bash
sudo ./src/scripts/legacy-migration/setup-archive-to-r2-vm.sh \
  /run/secrets/cocalc/cocalc-legacy-gcs-readonly.json
```

The optional key path activates the read-only GCS service account for root,
which matters because the recovery worker usually runs with `sudo`.

Example:

```bash
sudo ./src/scripts/legacy-migration/archive_to_r2.py \
  --r2-env-file /run/secrets/cocalc/r2.sh \
  --ids-file /home/user/scratch/legacy-inventory/active_missing_r2_but_gcs_project_ids.tsv.gz \
  --limit 10
```

The default compression is `zstd -3 --long=27 -T0`, which favors migration
throughput over maximum compression. Use `--zstd-level` and `--zstd-threads` to
tune worker shape. For one worker per VM, `--zstd-threads 0` lets zstd use the
available CPUs during the final tar/compress phase. If multiple workers share a
VM, cap each worker with `--zstd-threads` to avoid CPU oversubscription.

The script writes a JSON result line per project and writes a sidecar to:

```text
legacy-recovery/prod3/default/<project_id>.json
```

after successful upload.

For the full recovery run, generate ordered ID files externally and run recent
projects first, then drain the complete `kucalc-prod2-archived-projects`
inventory. The worker is idempotent by default: an existing final
`prod3/default/<project_id>.tar.zst` is skipped unless `--force` is passed.

Run one worker per VM with the default `--pool archive2r2`, or use a unique
`--pool` and `--workdir` per concurrent worker on the same VM. The ZFS fallback
uses a file-backed scratch pool and must not share a pool name between processes.

The final R2 upload is promoted as:

1. upload to `<project_id>.tar.zst.partial`
2. verify remote size
3. server-side move to `<project_id>.tar.zst`

This avoids replacing a good object with a failed upload.
