#!/usr/bin/env python3
"""
Create a reversible dormant-project corpus for staging scalability tests.

This intentionally bypasses the control plane. It exercises project-host SQLite
and Btrfs cardinality without creating user-visible PostgreSQL project records.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sqlite3
import subprocess
import sys
import time
from pathlib import Path
from typing import Any

DEFAULT_DB = Path("/mnt/cocalc/data/sqlite.db")
DEFAULT_MOUNT = Path("/mnt/cocalc")
DEFAULT_ENV = Path("/etc/cocalc/project-host.env")
MARKER_NAME = ".quota-startup-scale-corpus.json"
PROJECT_PREFIX = "70000000-0000-4000-8000-"
TITLE_PREFIX = "[staging quota startup scale corpus]"
MAX_COUNT = 50_000


def parse_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    for raw in path.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip().strip("'\"")
    return values


def installed_host_id(path: Path) -> str:
    env = parse_env(path)
    for key in ("PROJECT_HOST_ID", "COCALC_PROJECT_HOST_ID", "HOST_ID"):
        value = env.get(key)
        if value:
            return value
    raise RuntimeError(f"no project-host id found in {path}")


def project_id(index: int) -> str:
    return f"{PROJECT_PREFIX}{index:012x}"


def project_path(mount: Path, index: int) -> Path:
    return mount / f"project-{project_id(index)}"


def run(args: list[str], *, quiet: bool = False) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        args,
        check=True,
        text=True,
        stdout=subprocess.DEVNULL if quiet else subprocess.PIPE,
        stderr=subprocess.PIPE,
    )


def btrfs_subvolume_count(mount: Path) -> int:
    output = run(["btrfs", "subvolume", "list", str(mount)]).stdout
    return len(output.splitlines())


def btrfs_qgroup_count(mount: Path) -> int:
    output = run(["btrfs", "qgroup", "show", "--raw", str(mount)]).stdout
    return max(0, len(output.splitlines()) - 2)


def wait_for_qgroup_cleanup(
    mount: Path,
    *,
    target: int,
    timeout_seconds: int,
) -> tuple[int, float]:
    started = time.monotonic()
    current = btrfs_qgroup_count(mount)
    while current > target:
        elapsed = time.monotonic() - started
        if elapsed >= timeout_seconds:
            raise RuntimeError(
                "timed out waiting for qgroup cleanup "
                f"(target={target}, current={current}, timeout={timeout_seconds}s)"
            )
        time.sleep(min(5, max(0.1, timeout_seconds - elapsed)))
        current = btrfs_qgroup_count(mount)
    return current, time.monotonic() - started


def sqlite_file_owners(db_path: Path) -> dict[Path, tuple[int, int]]:
    owners: dict[Path, tuple[int, int]] = {}
    db_stat = db_path.stat()
    default_owner = (db_stat.st_uid, db_stat.st_gid)
    for path in (db_path, Path(f"{db_path}-wal"), Path(f"{db_path}-shm")):
        if path.exists():
            stat = path.stat()
            owners[path] = (stat.st_uid, stat.st_gid)
        else:
            owners[path] = default_owner
    return owners


def restore_sqlite_file_owners(owners: dict[Path, tuple[int, int]]) -> None:
    for path, (uid, gid) in owners.items():
        if path.exists():
            os.chown(path, uid, gid)


def corpus_row_count(db_path: Path) -> int:
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        return int(
            connection.execute(
                "SELECT count(*) FROM projects WHERE title = ?", (TITLE_PREFIX,)
            ).fetchone()[0]
        )
    finally:
        connection.close()


def table_exists(connection: sqlite3.Connection, table: str) -> bool:
    return (
        connection.execute(
            "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
            (table,),
        ).fetchone()
        is not None
    )


def corpus_dependent_row_counts(db_path: Path) -> dict[str, int]:
    connection = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        counts: dict[str, int] = {}
        for table in (
            "btrfs_quota_queue",
            "project_volume_quotas",
            "project_volumes",
        ):
            if table_exists(connection, table):
                counts[table] = int(
                    connection.execute(
                        f"SELECT count(*) FROM {table} WHERE project_id LIKE ?",
                        (f"{PROJECT_PREFIX}%",),
                    ).fetchone()[0]
                )
        return counts
    finally:
        connection.close()


def marker_path(db_path: Path) -> Path:
    return db_path.parent / MARKER_NAME


def read_marker(db_path: Path) -> dict[str, Any] | None:
    path = marker_path(db_path)
    if not path.exists():
        return None
    return json.loads(path.read_text())


def write_marker(db_path: Path, marker: dict[str, Any]) -> None:
    path = marker_path(db_path)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(marker, sort_keys=True, indent=2) + "\n")
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)


def validate_args(args: argparse.Namespace) -> str:
    if os.geteuid() != 0:
        raise RuntimeError("run this tool as root")
    if not re.fullmatch(r"[0-9a-f-]{36}", args.expected_host_id):
        raise RuntimeError("--expected-host-id must be a UUID")
    actual = installed_host_id(args.env)
    if actual != args.expected_host_id:
        raise RuntimeError(
            f"host identity mismatch: expected {args.expected_host_id}, installed {actual}"
        )
    if args.count < 1 or args.count > MAX_COUNT:
        raise RuntimeError(f"--count must be between 1 and {MAX_COUNT}")
    if args.mount.resolve() != DEFAULT_MOUNT or args.db.resolve() != DEFAULT_DB:
        raise RuntimeError("non-default mount or database paths are not supported")
    return actual


def seed(args: argparse.Namespace, host_id: str) -> dict[str, Any]:
    existing_marker = read_marker(args.db)
    if existing_marker and (
        existing_marker.get("host_id") != host_id
        or int(existing_marker.get("count", 0)) != args.count
    ):
        raise RuntimeError(
            f"incompatible corpus marker already exists: {existing_marker}"
        )
    marker = existing_marker or {
        "schema": 1,
        "host_id": host_id,
        "count": args.count,
        "project_prefix": PROJECT_PREFIX,
        "title": TITLE_PREFIX,
        "created_at": time.time(),
        "baseline_subvolumes": btrfs_subvolume_count(args.mount),
        "baseline_qgroups": btrfs_qgroup_count(args.mount),
        "created_subvolumes": 0,
        "inserted_rows": 0,
    }
    if not existing_marker:
        if corpus_row_count(args.db):
            raise RuntimeError("reserved corpus rows exist without a marker")
        dependent_rows = corpus_dependent_row_counts(args.db)
        if any(dependent_rows.values()):
            raise RuntimeError(
                f"reserved corpus ledger rows exist without a marker: {dependent_rows}"
            )
        conflicts = [
            str(project_path(args.mount, index))
            for index in range(1, args.count + 1)
            if project_path(args.mount, index).exists()
        ]
        if conflicts:
            raise RuntimeError(
                f"reserved corpus paths exist without a marker: {conflicts[:3]}"
            )
    write_marker(args.db, marker)

    started = time.monotonic()
    created = 0
    for index in range(1, args.count + 1):
        path = project_path(args.mount, index)
        if not path.exists():
            run(["btrfs", "subvolume", "create", str(path)], quiet=True)
            os.chown(path, args.runtime_uid, args.runtime_gid)
            created += 1
        if index % 100 == 0 or index == args.count:
            marker["created_subvolumes"] = index
            write_marker(args.db, marker)

    owners = sqlite_file_owners(args.db)
    now = int(time.time() * 1000)
    connection = sqlite3.connect(args.db, timeout=30)
    try:
        connection.execute("PRAGMA busy_timeout=30000")
        connection.execute("BEGIN IMMEDIATE")
        for index in range(1, args.count + 1):
            connection.execute(
                """
                INSERT OR IGNORE INTO projects
                  (project_id, title, state, disk, scratch, last_seen, updated_at,
                   run_quota, run_quota_revision)
                VALUES (?, ?, 'closed', 0, 0, ?, ?, ?, 1)
                """,
                (
                    project_id(index),
                    TITLE_PREFIX,
                    now,
                    now,
                    json.dumps(
                        {
                            "disk_quota": args.quota_bytes // 1_000_000,
                            "scratch_quota": args.quota_bytes // 1_000_000,
                        },
                        separators=(",", ":"),
                    ),
                ),
            )
        connection.commit()
    finally:
        connection.close()
        restore_sqlite_file_owners(owners)
    marker["inserted_rows"] = corpus_row_count(args.db)
    marker["seed_finished_at"] = time.time()
    write_marker(args.db, marker)
    return {
        "operation": "seed",
        "host_id": host_id,
        "requested_count": args.count,
        "created_subvolumes": created,
        "corpus_rows": marker["inserted_rows"],
        "total_subvolumes": btrfs_subvolume_count(args.mount),
        "total_qgroups": btrfs_qgroup_count(args.mount),
        "duration_seconds": round(time.monotonic() - started, 3),
        "marker": str(marker_path(args.db)),
    }


def cleanup(args: argparse.Namespace, host_id: str) -> dict[str, Any]:
    marker = read_marker(args.db)
    if not marker:
        raise RuntimeError(f"no corpus marker at {marker_path(args.db)}")
    if marker.get("host_id") != host_id:
        raise RuntimeError(f"corpus marker belongs to another host: {marker}")
    count = int(marker.get("count", 0))
    if count < 1 or count > MAX_COUNT:
        raise RuntimeError(f"invalid corpus count in marker: {count}")

    started = time.monotonic()
    deleted = 0
    for index in range(1, count + 1):
        path = project_path(args.mount, index)
        if path.exists():
            run(["btrfs", "subvolume", "delete", str(path)], quiet=True)
            deleted += 1
    run(["btrfs", "filesystem", "sync", str(args.mount)], quiet=True)
    baseline_qgroups = int(marker.get("baseline_qgroups", 0))
    final_qgroups, qgroup_cleanup_seconds = wait_for_qgroup_cleanup(
        args.mount,
        target=baseline_qgroups,
        timeout_seconds=args.cleanup_timeout_seconds,
    )

    owners = sqlite_file_owners(args.db)
    connection = sqlite3.connect(args.db, timeout=30)
    removed_dependent_rows: dict[str, int] = {}
    try:
        connection.execute("PRAGMA busy_timeout=30000")
        connection.execute("BEGIN IMMEDIATE")
        for table in (
            "btrfs_quota_queue",
            "project_volume_quotas",
            "project_volumes",
        ):
            if table_exists(connection, table):
                removed_dependent_rows[table] = connection.execute(
                    f"DELETE FROM {table} WHERE project_id LIKE ?",
                    (f"{PROJECT_PREFIX}%",),
                ).rowcount
        removed_rows = connection.execute(
            "DELETE FROM projects WHERE title = ? AND project_id LIKE ?",
            (TITLE_PREFIX, f"{PROJECT_PREFIX}%"),
        ).rowcount
        connection.commit()
    finally:
        connection.close()
        restore_sqlite_file_owners(owners)
    marker_path(args.db).unlink()
    return {
        "operation": "cleanup",
        "host_id": host_id,
        "deleted_subvolumes": deleted,
        "deleted_rows": removed_rows,
        "deleted_dependent_rows": removed_dependent_rows,
        "total_subvolumes": btrfs_subvolume_count(args.mount),
        "total_qgroups": final_qgroups,
        "qgroup_cleanup_seconds": round(qgroup_cleanup_seconds, 3),
        "duration_seconds": round(time.monotonic() - started, 3),
    }


def status(args: argparse.Namespace, host_id: str) -> dict[str, Any]:
    marker = read_marker(args.db)
    expected_count = int(marker.get("count", 0)) if marker else 0
    existing_paths = sum(
        project_path(args.mount, index).exists()
        for index in range(1, expected_count + 1)
    )
    return {
        "operation": "status",
        "host_id": host_id,
        "marker": marker,
        "corpus_rows": corpus_row_count(args.db),
        "corpus_subvolumes": existing_paths,
        "total_subvolumes": btrfs_subvolume_count(args.mount),
        "total_qgroups": btrfs_qgroup_count(args.mount),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("operation", choices=("seed", "status", "cleanup"))
    parser.add_argument("--expected-host-id", required=True)
    parser.add_argument("--count", type=int, default=10_000)
    parser.add_argument("--quota-bytes", type=int, default=1_000_000_000)
    parser.add_argument("--runtime-uid", type=int, default=2000)
    parser.add_argument("--runtime-gid", type=int, default=2000)
    parser.add_argument("--cleanup-timeout-seconds", type=int, default=300)
    parser.add_argument("--db", type=Path, default=DEFAULT_DB)
    parser.add_argument("--mount", type=Path, default=DEFAULT_MOUNT)
    parser.add_argument("--env", type=Path, default=DEFAULT_ENV)
    args = parser.parse_args()
    try:
        host_id = validate_args(args)
        if args.operation == "seed":
            result = seed(args, host_id)
        elif args.operation == "cleanup":
            result = cleanup(args, host_id)
        else:
            result = status(args, host_id)
        print(json.dumps(result, sort_keys=True, indent=2))
        return 0
    except Exception as err:
        print(f"error: {err}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
