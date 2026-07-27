# Project-host persistence observability

## Purpose

The hub and standalone project-host persistence services both use the Conat
SQLite persistence implementation. The hub investigation showed that many
independent SQLite connections can consume substantial native memory even when
V8 heap use is modest. Project hosts have fewer streams per process, but they
have the same structural risk.

This instrumentation is diagnostic only. It does not restart persistence,
close streams, stop projects, alter placement, or compact databases.

## Architecture boundary

Do not move persistence back into one global PostgreSQL table. CoCalc
previously used that design and its backup, restore, and operational management
were poor.

The current durable boundary remains useful:

- Project persistence stays with the project and its snapshots.
- Project hosts keep independent per-project backup and restore behavior.
- PostgreSQL stores only bounded, low-resolution operational measurements.
- A future hub-only design may consolidate ephemeral streams into a fixed
  number of local SQLite shards because the hub is centralized and persistence
  is hidden behind an API.

Changing the project-host on-disk layout requires a separate migration design.

## Local diagnostics

The standalone `conat-persist` process serves `GET /diagnostics` on its
existing health listener. The route:

- accepts only IPv4, IPv6, or IPv4-mapped loopback peers;
- returns `404` to non-loopback peers;
- sets `Cache-Control: no-cache, no-store`;
- never returns SQLite paths, project IDs, account IDs, or message contents.

The default response is cheap and includes:

- process RSS, V8 heap, external memory, array buffers, and resource usage;
- V8 heap-space and large-object-space statistics;
- event-loop utilization and active-resource counts;
- Conat subscription count;
- opened, closed, open, disk, ephemeral, cached, and referenced stream counts;
- maintenance-catalog database, main-file, and WAL totals;
- maintenance scan time and tracking health.

Maintenance file and WAL totals are catalog observations, normally refreshed by
the bounded scanner. Always interpret them together with
`maintenance_last_scan_completed_at_ms`.

`GET /diagnostics?persistence=full` additionally queries every currently open
SQLite connection and stats its main, WAL, and SHM files. It aggregates page,
freelist, logical message, main-file, WAL, and SHM bytes without returning
paths. This is operator-triggered because it is O(open databases).

Example on a project host:

```bash
curl -fsS \
  "http://127.0.0.1:${COCALC_PROJECT_HOST_CONAT_PERSIST_HEALTH_PORT}/diagnostics" \
  | jq

curl -fsS \
  "http://127.0.0.1:${COCALC_PROJECT_HOST_CONAT_PERSIST_HEALTH_PORT}/diagnostics?persistence=full" \
  | jq '.conat.persistence.sqlite_detail'
```

## Central monitoring

The project-host heartbeat reads the local diagnostics endpoint alongside the
normal host metrics, without failing the heartbeat if diagnostics are
unavailable.

- Host heartbeats contain a bounded `metrics.current.conat_persist` summary.
- PostgreSQL records at most one sample per host per minute.
- History queries support at most seven days.
- Samples older than eight days are removed every ten minutes in batches of at
  most 25,000.
- A PostgreSQL advisory lock ensures only one hub worker prunes at a time.
- Pruning avoids a new production index build and deletes bounded expired
  batches without sorting the historical table.

The CLI fleet view is:

```bash
cocalc host persistence
cocalc host persistence asia-1
cocalc --output json host persistence
```

The table sorts hosts by persistence RSS and shows heap, stream cardinality,
catalog database count, SQLite main-file bytes, WAL bytes, scan time, collection
time, and errors. JSON output additionally includes external memory,
large-object-space use, subscriptions, event-loop utilization, and lifecycle
counters.

## Alerts

The existing host availability maintenance loop sends an observational admin
alert for fresh metrics when either threshold is crossed:

- RSS warning: 1 GiB
- RSS critical: 2 GiB
- Open streams warning: 2,000
- Open streams critical: 5,000

The defaults can be overridden with:

```text
COCALC_HOST_CONAT_PERSIST_WARNING_RSS_BYTES
COCALC_HOST_CONAT_PERSIST_CRITICAL_RSS_BYTES
COCALC_HOST_CONAT_PERSIST_WARNING_OPEN_STREAMS
COCALC_HOST_CONAT_PERSIST_CRITICAL_OPEN_STREAMS
COCALC_HOST_CONAT_PERSIST_ALERT_FRESH_METRICS_MS
```

Alerts are deduplicated for 30 minutes. WAL is measured but does not alert until
production baselines establish a defensible threshold.

## Initial observations

A read-only survey before this instrumentation found persistence daemon RSS of
approximately 159-409 MiB across 18 running project hosts, with roughly 3-520
open disk databases per daemon. This is not currently an emergency, but it is
enough to justify longitudinal monitoring.

SQLite WAL can amplify disk use across many small databases. With a typical
4 KiB page size and SQLite's default 1,000-page auto-checkpoint threshold, one
busy database can approach roughly 4 MiB of WAL before checkpointing. Hundreds
of independently active databases can therefore consume gigabytes of aggregate
WAL even when logical payload is small.

## Next decision

Collect at least several days spanning weekday load before changing storage.
Correlate per daemon:

- RSS versus open disk and ephemeral streams;
- RSS minus V8 heap versus SQLite cache configuration;
- WAL bytes versus open streams and write activity;
- opened/closed totals versus stable open-stream cardinality;
- restart baselines versus long-running plateaus.

If project-host RSS or WAL scales materially with stream cardinality, first test
lower SQLite cache limits and explicit WAL checkpoint policy. Any project-host
database consolidation must preserve project-local backup, snapshot, and
restore semantics.
