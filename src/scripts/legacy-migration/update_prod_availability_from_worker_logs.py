#!/usr/bin/env python3
"""
Positive-only production DB updater for legacy project archive availability.

This consumes the compact TSV derived from archive_to_r2.py worker JSONL logs:

    legacy_project_id artifact_key artifact_bytes status finished_at shard

It updates only rows with observed final R2 objects. It never marks anything
unavailable. Each chunk is sent through the audited production CLI
`admin db exec` path as one SQL statement.
"""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


def now_iso() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat()


def load_completed_chunks(path: Path) -> set[int]:
    done: set[int] = set()
    if not path.exists():
        return done
    with path.open("rt", encoding="utf-8") as f:
        for line in f:
            if not line.strip():
                continue
            try:
                rec = json.loads(line)
            except json.JSONDecodeError:
                continue
            if rec.get("ok") and rec.get("committed") and rec.get("chunk_index") is not None:
                done.add(int(rec["chunk_index"]))
    return done


def iter_chunks(path: Path, chunk_size: int):
    with path.open("rt", encoding="utf-8", newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        chunk: list[dict[str, Any]] = []
        chunk_index = 0
        for row in reader:
            chunk.append(
                {
                    "legacy_project_id": row["legacy_project_id"],
                    "artifact_key": row["artifact_key"],
                    "artifact_bytes": int(row["artifact_bytes"] or 0),
                }
            )
            if len(chunk) >= chunk_size:
                yield chunk_index, chunk
                chunk_index += 1
                chunk = []
        if chunk:
            yield chunk_index, chunk


def sql_for(rows: list[dict[str, Any]]) -> str:
    payload = json.dumps(rows, separators=(",", ":"))
    return f"""WITH input AS (
  SELECT *
    FROM jsonb_to_recordset($json${payload}$json$::jsonb) AS x(
      legacy_project_id TEXT,
      artifact_key TEXT,
      artifact_bytes BIGINT
    )
), updated AS (
  UPDATE legacy_migration_projects p
     SET artifact_bucket='cocalc-projects',
         artifact_key=i.artifact_key,
         artifact_status='available',
         artifact_manifest=jsonb_strip_nulls(
           (COALESCE(p.artifact_manifest, '{{}}'::jsonb) - 'r2_missing')
           || jsonb_build_object(
                'artifact_bytes', i.artifact_bytes,
                'compressed_bytes', i.artifact_bytes,
                'r2_bucket', 'cocalc-projects',
                'r2_key', i.artifact_key,
                'r2_refreshed_at', NOW(),
                'r2_refresh_source', 'archive-to-r2-worker-logs-20260709'
              )
         ),
         updated=NOW()
    FROM input i
   WHERE p.legacy_project_id=i.legacy_project_id
     AND (
       p.artifact_bucket IS DISTINCT FROM 'cocalc-projects'
       OR p.artifact_key IS DISTINCT FROM i.artifact_key
       OR p.artifact_status IS DISTINCT FROM 'available'
       OR p.artifact_manifest IS NULL
       OR COALESCE(p.artifact_manifest->>'r2_missing', '')='true'
       OR p.artifact_manifest->>'artifact_bytes' IS DISTINCT FROM i.artifact_bytes::text
       OR p.artifact_manifest->>'compressed_bytes' IS DISTINCT FROM i.artifact_bytes::text
       OR p.artifact_manifest->>'r2_bucket' IS DISTINCT FROM 'cocalc-projects'
       OR p.artifact_manifest->>'r2_key' IS DISTINCT FROM i.artifact_key
     )
   RETURNING 1
)
SELECT (SELECT COUNT(*)::INTEGER FROM input) AS input_rows,
       (SELECT COUNT(*)::INTEGER FROM updated) AS updated_rows"""


def run_chunk(opts: dict[str, Any]) -> subprocess.CompletedProcess[str]:
    cli = opts["cli"]
    sql_path = opts["sql_path"]
    response_path = opts["response_path"]
    stderr_path = opts["stderr_path"]
    chunk_index = opts["chunk_index"]
    reason = (
        "positive-only legacy archive availability update from archive-to-r2 "
        f"worker logs, chunk {chunk_index}"
    )
    with response_path.open("wt", encoding="utf-8") as stdout, stderr_path.open(
        "wt", encoding="utf-8"
    ) as stderr:
        return subprocess.run(
            [
                "node",
                str(cli),
                "--profile",
                "prod",
                "--api",
                "https://cocalc.ai",
                "--output",
                "json",
                "admin",
                "db",
                "exec",
                "--write",
                "--commit",
                "--file",
                str(sql_path),
                "--reason",
                reason,
                "--timeout-ms",
                "120000",
                "--lock-timeout-ms",
                "10000",
                "--max-bytes",
                "1048576",
            ],
            cwd=str(cli.parents[4]),
            text=True,
            stdout=stdout,
            stderr=stderr,
        )


def parse_response(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text())
    if not data.get("ok"):
        raise RuntimeError(f"CLI returned ok=false in {path}")
    payload = data["data"]
    rows = payload.get("rows") or []
    if not rows or len(rows[0]) < 2:
        raise RuntimeError(f"unexpected response rows in {path}: {rows!r}")
    return {
        "audit_id": payload.get("audit_id"),
        "server_time": payload.get("server_time"),
        "duration_ms": payload.get("duration_ms"),
        "committed": payload.get("committed"),
        "input_rows": rows[0][0],
        "updated_rows": rows[0][1],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--workdir", required=True, type=Path)
    parser.add_argument("--chunk-size", type=int, default=10_000)
    parser.add_argument("--limit-chunks", type=int)
    parser.add_argument(
        "--cli",
        type=Path,
        default=Path("/home/user/cocalc-ai/src/packages/cli/dist/bin/cocalc.js"),
    )
    args = parser.parse_args()
    args.workdir.mkdir(parents=True, exist_ok=True)
    results_path = args.workdir / "prod-db-update-results.jsonl"
    state_path = args.workdir / "prod-db-update-state.json"
    completed = load_completed_chunks(results_path)
    sql_path = args.workdir / "current-chunk.sql"
    response_path = args.workdir / "current-response.json"
    stderr_path = args.workdir / "current-stderr.log"

    processed_chunks = 0
    started = time.time()
    totals = {"input_rows": 0, "updated_rows": 0, "chunks": 0, "skipped_chunks": 0}
    with results_path.open("at", encoding="utf-8") as results:
        for chunk_index, rows in iter_chunks(args.input, args.chunk_size):
            if args.limit_chunks is not None and processed_chunks >= args.limit_chunks:
                break
            processed_chunks += 1
            if chunk_index in completed:
                totals["skipped_chunks"] += 1
                continue
            sql_path.write_text(sql_for(rows), encoding="utf-8")
            started_chunk = time.time()
            proc = run_chunk(
                {
                    "cli": args.cli,
                    "sql_path": sql_path,
                    "response_path": response_path,
                    "stderr_path": stderr_path,
                    "chunk_index": chunk_index,
                }
            )
            if proc.returncode != 0:
                state_path.write_text(
                    json.dumps(
                        {
                            "ok": False,
                            "failed_chunk": chunk_index,
                            "returncode": proc.returncode,
                            "stderr_path": str(stderr_path),
                            "response_path": str(response_path),
                            "updated_at": now_iso(),
                        },
                        indent=2,
                        sort_keys=True,
                    )
                )
                return proc.returncode
            parsed = parse_response(response_path)
            rec = {
                "ok": True,
                "chunk_index": chunk_index,
                "chunk_rows": len(rows),
                "elapsed_s": round(time.time() - started_chunk, 3),
                **parsed,
            }
            results.write(json.dumps(rec, sort_keys=True) + "\n")
            results.flush()
            totals["chunks"] += 1
            totals["input_rows"] += int(parsed["input_rows"])
            totals["updated_rows"] += int(parsed["updated_rows"])
            if totals["chunks"] % 10 == 0:
                print(json.dumps({"updated_at": now_iso(), **totals}), flush=True)
            state_path.write_text(
                json.dumps(
                    {
                        "ok": True,
                        "last_chunk": chunk_index,
                        "updated_at": now_iso(),
                        "elapsed_s": round(time.time() - started, 3),
                        **totals,
                    },
                    indent=2,
                    sort_keys=True,
                )
            )
    print(json.dumps({"updated_at": now_iso(), "elapsed_s": round(time.time() - started, 3), **totals}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
