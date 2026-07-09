#!/usr/bin/env python3
"""
Convert a legacy CoCalc.com GCS archive tar into the cocalc.ai R2 restore object.

Input:
    gs://kucalc-prod2-archived-projects/<namespace>/project-<project_id>.tar

Output:
    r2:<bucket>/<cluster>/<namespace>/<project_id>.tar.zst

Recovery strategy:
    1. Extract and restore the archive's bup repo when possible.
    2. If bup is absent or fails, extract the lz4 ZFS stream chain, replay it
       into a throwaway file-backed ZFS pool, and export that filesystem.

The upload is clobber-safe: write .partial, verify size, then server-side move
to the final key. A separate sidecar under legacy-recovery/ records provenance.

Run this on a VM with:
    bup, lz4, zstd, rclone, tar, zfsutils-linux, gsutil or gcloud

The lz4/ZFS fallback needs root privileges. Running the whole script under sudo
is the simplest operational mode on a dedicated migration VM.
"""

from __future__ import annotations

import argparse
import datetime as dt
import gzip
import json
import os
import re
import shlex
import shutil
import subprocess
import sys
import time
from pathlib import Path
from typing import Any


UUID_RE = re.compile(
    r"^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$",
    re.I,
)
STREAM_RE = re.compile(r"^[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}--[0-9]{4}-[0-9]{2}-[0-9]{2}-[0-9]{6}\.(?:lz4|zfs)$")

ROOT_EXCLUDES = [
    ".conda",
    ".npm",
    ".cache",
    ".julia",
    ".local/share/pnpm",
    ".jupyter-blobs-v0.db",
    ".xpra",
]
# Empty or nearly-empty legacy projects can still produce valid tiny tar.zst files.
MIN_ARTIFACT_BYTES = 16


def log(*args: object) -> None:
    print("[archive-to-r2]", *args, file=sys.stderr, flush=True)


def now_iso() -> str:
    return dt.datetime.now(dt.UTC).replace(microsecond=0).isoformat()


def run(argv: list[str], **kw: Any) -> subprocess.CompletedProcess:
    log("+", " ".join(shlex.quote(x) for x in argv))
    return subprocess.run(argv, check=True, text=True, **kw)


def run_shell(cmd: str, **kw: Any) -> subprocess.CompletedProcess:
    log("+", cmd)
    return subprocess.run(["bash", "-lc", f"set -o pipefail; {cmd}"], check=True, text=True, **kw)


def root_argv(argv: list[str]) -> list[str]:
    if os.geteuid() == 0:
        return argv
    return ["sudo", *argv]


def root_run(argv: list[str], **kw: Any) -> subprocess.CompletedProcess:
    return run(root_argv(argv), **kw)


def root_run_no_check(argv: list[str], **kw: Any) -> subprocess.CompletedProcess:
    log("+", " ".join(shlex.quote(x) for x in root_argv(argv)))
    return subprocess.run(root_argv(argv), text=True, **kw)


def require_tools(names: list[str]) -> None:
    missing = [name for name in names if shutil.which(name) is None]
    if missing:
        raise SystemExit(f"missing required tool(s): {', '.join(missing)}")


def gcs_cat_command(url: str) -> str:
    if shutil.which("gsutil"):
        return f"gsutil cat {shlex.quote(url)}"
    if shutil.which("gcloud"):
        return f"gcloud storage cat {shlex.quote(url)}"
    raise SystemExit("need either gsutil or gcloud on PATH for GCS reads")


def gcs_ls_command(url: str) -> list[str]:
    if shutil.which("gsutil"):
        return ["gsutil", "-q", "stat", url]
    if shutil.which("gcloud"):
        return ["gcloud", "storage", "ls", url]
    raise SystemExit("need either gsutil or gcloud on PATH for GCS reads")


def gcs_exists(url: str) -> bool:
    proc = subprocess.run(gcs_ls_command(url), capture_output=True, text=True)
    return proc.returncode == 0


def parse_env_file(path: str | None) -> dict[str, str]:
    if not path:
        return {}
    env: dict[str, str] = {}
    with open(path, encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("export "):
                line = line[len("export ") :].strip()
            if "=" not in line:
                continue
            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            try:
                parts = shlex.split(value)
                value = parts[0] if parts else ""
            except ValueError:
                value = value.strip("'\"")
            env[key] = value
    return env


def r2_config(args: argparse.Namespace) -> dict[str, str]:
    file_env = parse_env_file(args.r2_env_file)

    def get(*names: str, default: str | None = None) -> str:
        for name in names:
            if os.environ.get(name):
                return os.environ[name]
            if file_env.get(name):
                return file_env[name]
        if default is not None:
            return default
        raise SystemExit(f"missing R2 credential value; tried {', '.join(names)}")

    return {
        "bucket": args.r2_bucket or get("R2_BUCKET", "bucket", default="cocalc-projects"),
        "access_key_id": get("R2_ACCESS_KEY_ID", "access_key_id"),
        "secret_access_key": get("R2_SECRET_ACCESS_KEY", "secret_access_key"),
        "endpoint": get("R2_ENDPOINT", "s3_endpoint"),
    }


def rclone_env(config: dict[str, str]) -> dict[str, str]:
    env = dict(os.environ)
    env.update(
        RCLONE_CONFIG_R2_TYPE="s3",
        RCLONE_CONFIG_R2_PROVIDER="Cloudflare",
        RCLONE_CONFIG_R2_REGION="auto",
        RCLONE_S3_NO_CHECK_BUCKET="true",
        RCLONE_CONFIG_R2_ACCESS_KEY_ID=config["access_key_id"],
        RCLONE_CONFIG_R2_SECRET_ACCESS_KEY=config["secret_access_key"],
        RCLONE_CONFIG_R2_ENDPOINT=config["endpoint"],
    )
    return env


def r2_size(config: dict[str, str], key: str) -> int | None:
    proc = subprocess.run(
        ["rclone", "lsjson", "--stat", f"r2:{config['bucket']}/{key}"],
        env=rclone_env(config),
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0 or not proc.stdout.strip():
        return None
    try:
        data = json.loads(proc.stdout)
    except json.JSONDecodeError:
        return None
    if data.get("IsDir"):
        return None
    size = data.get("Size")
    return int(size) if isinstance(size, int) and size >= 0 else None


def r2_write_json(config: dict[str, str], key: str, payload: dict[str, Any]) -> None:
    proc = subprocess.run(
        ["rclone", "rcat", f"r2:{config['bucket']}/{key}"],
        env=rclone_env(config),
        input=json.dumps(payload, sort_keys=True) + "\n",
        text=True,
        capture_output=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"rclone rcat sidecar failed: {(proc.stderr or '')[:300]}")


def r2_upload_promote(config: dict[str, str], artifact: Path, key: str) -> None:
    env = rclone_env(config)
    partial = f"{key}.partial"
    run(
        [
            "rclone",
            "copyto",
            "--header-upload",
            "Content-Type: application/zstd",
            str(artifact),
            f"r2:{config['bucket']}/{partial}",
            "-q",
        ],
        env=env,
    )
    local_size = artifact.stat().st_size
    remote_size = r2_size(config, partial)
    if remote_size != local_size:
        subprocess.run(["rclone", "deletefile", f"r2:{config['bucket']}/{partial}"], env=env)
        raise RuntimeError(f"partial upload size mismatch: local={local_size} remote={remote_size}")
    run(["rclone", "moveto", f"r2:{config['bucket']}/{partial}", f"r2:{config['bucket']}/{key}", "-q"], env=env)
    final_size = r2_size(config, key)
    if final_size != local_size:
        raise RuntimeError(f"final upload size mismatch: local={local_size} remote={final_size}")


def parse_stream_filename(name: str) -> dict[str, Any]:
    base = name.rsplit("/", 1)[-1].split(".", 1)[0]
    start, end = base.split("--", 1)
    return {"start": start, "end": end, "name": name}


def ordered_chain(streams: list[str]) -> list[str]:
    streams = sorted(streams)
    if not streams:
        return []
    parsed = [parse_stream_filename(name) for name in streams]
    parsed.sort(key=lambda item: item["end"])
    for i, item in enumerate(parsed):
        item["del"] = False
        item["i"] = i
    i = len(parsed) - 1
    while i >= 0 and parsed[i]["start"] != parsed[i]["end"]:
        i -= 1
    if i < 0:
        return []
    for j in range(i):
        parsed[j]["del"] = True
    prev_end = parsed[i]["end"]
    i += 1
    while i < len(parsed):
        choices = [item for item in parsed[i:] if item["start"] == prev_end and not item["del"]]
        if not choices:
            for item in parsed[i:]:
                item["del"] = True
            break
        for item in choices[:-1]:
            item["del"] = True
        item = choices[-1]
        prev_end = item["end"]
        i = int(item["i"]) + 1
    return sorted(str(item["name"]) for item in parsed if not item["del"])


def rm_tree(path: Path) -> None:
    if not path.exists():
        return
    if os.geteuid() != 0:
        subprocess.run(["chmod", "-R", "u+rwX", str(path)], stderr=subprocess.DEVNULL)
    shutil.rmtree(path, ignore_errors=True)


def extract_bup(archive_url: str, project_id: str, work: Path) -> tuple[bool, str]:
    member = f"project-{project_id}/bup"
    cmd = f"{gcs_cat_command(archive_url)} | tar x -C {shlex.quote(str(work))} {shlex.quote(member)}"
    proc = subprocess.run(["bash", "-lc", f"set -o pipefail; {cmd}"], capture_output=True, text=True)
    return (work / f"project-{project_id}" / "bup").is_dir(), (proc.stderr or "")[-4000:]


def extract_streams(archive_url: str, project_id: str, streams_dir: Path) -> list[str]:
    rm_tree(streams_dir)
    streams_dir.mkdir(parents=True, exist_ok=True)
    cmd = (
        f"{gcs_cat_command(archive_url)} | "
        f"tar x --strip-components=1 -C {shlex.quote(str(streams_dir))} "
        f"--exclude {shlex.quote(f'project-{project_id}/bup')}"
    )
    proc = subprocess.run(["bash", "-lc", f"set -o pipefail; {cmd}"], capture_output=True, text=True)
    if proc.returncode != 0:
        raise RuntimeError(f"extract streams failed: {(proc.stderr or '')[-1000:]}")
    streams = [item.name for item in streams_dir.iterdir() if item.is_file() and STREAM_RE.match(item.name)]
    return sorted(streams)


def restore_bup(bup_dir: Path, out_dir: Path) -> dict[str, Any]:
    rm_tree(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    env = dict(os.environ, BUP_DIR=str(bup_dir))
    proc = subprocess.run(
        ["bup", "restore", "--sparse", "--outdir", str(out_dir), "master/latest/"],
        env=env,
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        raise RuntimeError(f"bup restore failed: {(proc.stderr or proc.stdout or '')[-2000:]}")
    count = run_shell(f"find {shlex.quote(str(out_dir))} -type f | wc -l", capture_output=True)
    return {"method": "bup", "restored_files": int(count.stdout.strip() or "0")}


def ensure_pool(pool: str, image: Path, size: str) -> None:
    if not shutil.which("zfs") or not shutil.which("zpool"):
        raise RuntimeError("zfs/zpool not available; cannot use lz4 fallback")
    root_run_no_check(["zpool", "destroy", "-f", pool], capture_output=True)
    image.parent.mkdir(parents=True, exist_ok=True)
    if image.exists():
        image.unlink()
    run(["truncate", "-s", size, str(image)])
    root_run(["zpool", "create", "-o", "ashift=12", "-O", "atime=off", "-O", "compression=lz4", "-m", "none", pool, str(image)])


def destroy_pool(pool: str, image: Path) -> None:
    root_run_no_check(["zpool", "destroy", "-f", pool], capture_output=True)
    try:
        image.unlink()
    except FileNotFoundError:
        pass


def pipe_shell(cmd: str) -> subprocess.CompletedProcess:
    return subprocess.run(["bash", "-lc", f"set -o pipefail; {cmd}"], text=True, capture_output=True)


def zfs_stream_command(path: Path) -> str:
    if path.suffix == ".lz4":
        return f"lz4 -c -d {shlex.quote(str(path))}"
    return f"cat {shlex.quote(str(path))}"


def zfs_receive_chain(streams_dir: Path, chain: list[str], pool: str, dataset: str, xquota: bool = False) -> str:
    target = f"{pool}/{dataset}"
    root_run_no_check(["zfs", "destroy", "-r", target], capture_output=True)
    xopts = " -x quota -x refquota" if xquota else ""
    for index, name in enumerate(chain):
        path = streams_dir / name
        opts = ("-F -u" if index == 0 else "-u") + xopts
        recv = " ".join(shlex.quote(x) for x in root_argv(["zfs", "recv", *opts.split(), target]))
        cmd = f"{zfs_stream_command(path)} | {recv}"
        proc = pipe_shell(cmd)
        if proc.returncode == 0:
            continue
        err = proc.stderr or ""
        if "dedup" in err or "flags = 7" in err:
            redup = streams_dir / f"{name.rsplit('.', 1)[0]}.redup"
            if path.suffix == ".lz4":
                run(["lz4", "-d", "-f", str(path), str(redup)])
            else:
                shutil.copyfile(path, redup)
            cmd = f"zstream redup {shlex.quote(str(redup))} | {recv}"
            proc2 = pipe_shell(cmd)
            redup.unlink(missing_ok=True)
            if proc2.returncode != 0:
                raise RuntimeError(f"zstream redup recv failed: {(proc2.stderr or '')[-1000:]}")
        else:
            raise RuntimeError(f"zfs recv failed for {name}: {err[-1000:]}")
    return target


def zfs_receive(streams_dir: Path, chain: list[str], pool: str, dataset: str) -> str:
    try:
        return zfs_receive_chain(streams_dir, chain, pool, dataset, xquota=False)
    except RuntimeError as err:
        if "quota exceeded" not in str(err):
            raise
        log("quota rescue: replaying chain with recv -x quota -x refquota")
        return zfs_receive_chain(streams_dir, chain, pool, dataset, xquota=True)


def mount_dataset(target: str, mountpoint: Path) -> None:
    mountpoint.mkdir(parents=True, exist_ok=True)
    root_run(["zfs", "set", "mountpoint=legacy", target])
    root_run(["mount", "-t", "zfs", target, str(mountpoint)])


def restore_zfs(streams_dir: Path, out_dir: Path, pool: str, project_id: str) -> dict[str, Any]:
    streams = [item.name for item in streams_dir.iterdir() if item.is_file() and STREAM_RE.match(item.name)]
    chain = ordered_chain(streams)
    if not chain:
        raise RuntimeError(f"no complete zfs stream chain among {len(streams)} streams")
    rm_tree(out_dir)
    target = ""
    try:
        target = zfs_receive(streams_dir, chain, pool, f"restore-{project_id}")
        mount_dataset(target, out_dir)
        return {"method": "zfs", "stream_count": len(streams), "chain_len": len(chain), "watermark": parse_stream_filename(chain[-1])["end"]}
    except Exception:
        if target:
            root_run_no_check(["umount", str(out_dir)], capture_output=True)
            root_run_no_check(["zfs", "destroy", "-r", target], capture_output=True)
        raise


def cleanup_excludes(root: Path) -> None:
    cleanup = r"""
import os, shutil, sys
root = sys.argv[1]
root_real = os.path.realpath(root)
for rel in sys.argv[2:]:
    path = os.path.join(root, rel)
    if os.path.islink(path):
        os.remove(path)
        continue
    if not os.path.exists(path):
        continue
    if os.path.commonpath([root_real, os.path.realpath(path)]) != root_real:
        continue
    if os.path.isdir(path):
        shutil.rmtree(path, ignore_errors=True)
    else:
        os.remove(path)
"""
    root_run(["python3", "-c", cleanup, str(root), *ROOT_EXCLUDES])
    root_run_no_check(["find", str(root), "-type", "f", "-name", "*.tmp", "-delete"], capture_output=True)


def tar_zstd(root: Path, artifact: Path, zstd_level: int, zstd_long: int) -> None:
    if artifact.exists():
        artifact.unlink()
    tar_cmd = " ".join(shlex.quote(x) for x in root_argv(["tar", "-S", "-cf", "-", "-C", str(root), "."]))
    cmd = f"{tar_cmd} | zstd -{zstd_level} --long={zstd_long} -T0 -q -o {shlex.quote(str(artifact))}"
    run_shell(cmd)
    if artifact.stat().st_size < MIN_ARTIFACT_BYTES:
        raise RuntimeError(f"artifact is suspiciously tiny: {artifact.stat().st_size} bytes")


class ArchiveMigrator:
    def __init__(self, args: argparse.Namespace):
        self.args = args
        self.r2 = r2_config(args)
        self.pool_created = False
        self.pool_image = Path(args.workdir) / "archive-to-r2-pool.img"

    def ensure_pool(self) -> None:
        if self.pool_created:
            return
        ensure_pool(self.args.pool, self.pool_image, self.args.pool_size)
        self.pool_created = True

    def close(self) -> None:
        if self.pool_created:
            destroy_pool(self.args.pool, self.pool_image)
            self.pool_created = False

    def migrate_one(self, project_id: str) -> dict[str, Any]:
        t0 = time.time()
        namespace = self.args.namespace
        archive_url = f"gs://{self.args.archive_bucket}/{namespace}/project-{project_id}.tar"
        r2_key = f"{self.args.cluster}/{namespace}/{project_id}.tar.zst"
        sidecar_key = f"{self.args.sidecar_prefix.rstrip('/')}/{self.args.cluster}/{namespace}/{project_id}.json"
        result: dict[str, Any] = {
            "project_id": project_id,
            "namespace": namespace,
            "archive_url": archive_url,
            "r2_key": r2_key,
            "started_at": now_iso(),
            "worker": "archive_to_r2.py",
        }
        existing = r2_size(self.r2, r2_key)
        if existing is not None and not self.args.force:
            result.update(status="skipped_exists", artifact_bytes=existing, finished_at=now_iso(), duration_s=round(time.time() - t0, 3))
            return result
        if not gcs_exists(archive_url):
            result.update(status="no_archive", finished_at=now_iso(), duration_s=round(time.time() - t0, 3))
            return result

        project_work = Path(self.args.workdir) / project_id
        rm_tree(project_work)
        project_work.mkdir(parents=True, exist_ok=True)
        out_dir = project_work / "out"
        streams_dir = project_work / "streams"
        artifact = project_work / f"{project_id}.tar.zst"
        zfs_mounted = False
        zfs_target = ""
        method_info: dict[str, Any] = {}
        try:
            bup_ok, bup_extract_err = extract_bup(archive_url, project_id, project_work)
            if bup_ok:
                try:
                    bup_dir = project_work / f"project-{project_id}" / "bup"
                    method_info = restore_bup(bup_dir, out_dir)
                    rm_tree(project_work / f"project-{project_id}")
                except Exception as err:
                    result["bup_error"] = str(err)[-2000:]
                    log(project_id, "bup failed; falling back to zfs")
                    rm_tree(out_dir)
                    rm_tree(project_work / f"project-{project_id}")
            else:
                result["bup_error"] = f"no bup in archive: {bup_extract_err[-1000:]}"

            if not method_info:
                self.ensure_pool()
                streams = extract_streams(archive_url, project_id, streams_dir)
                if not streams:
                    raise RuntimeError("archive contains no usable bup repo and no lz4/zfs streams")
                method_info = restore_zfs(streams_dir, out_dir, self.args.pool, project_id)
                zfs_mounted = True
                zfs_target = f"{self.args.pool}/restore-{project_id}"

            cleanup_excludes(out_dir)
            tar_zstd(out_dir, artifact, self.args.zstd_level, self.args.zstd_long)
            result.update(method_info)
            result["artifact_bytes"] = artifact.stat().st_size
            if not self.args.dry_run:
                r2_upload_promote(self.r2, artifact, r2_key)
                result["uploaded"] = True
            else:
                result["uploaded"] = False
            result.update(status="done", finished_at=now_iso(), duration_s=round(time.time() - t0, 3))
            if not self.args.dry_run:
                r2_write_json(self.r2, sidecar_key, result)
            return result
        except Exception as err:
            result.update(status="error", error=str(err)[-4000:], finished_at=now_iso(), duration_s=round(time.time() - t0, 3))
            return result
        finally:
            if zfs_mounted:
                root_run_no_check(["umount", str(out_dir)], capture_output=True)
            if zfs_target:
                root_run_no_check(["zfs", "destroy", "-r", zfs_target], capture_output=True)
            if self.args.keep:
                result["kept_workdir"] = str(project_work)
            else:
                rm_tree(project_work)


def read_project_ids(args: argparse.Namespace) -> list[str]:
    ids = list(args.project_ids)
    if args.ids_file:
        opener = gzip.open if args.ids_file.endswith(".gz") else open
        with opener(args.ids_file, "rt", encoding="utf-8") as f:
            for line in f:
                token = line.strip().split("\t", 1)[0]
                if token and token != "project_id":
                    ids.append(token)
    out: list[str] = []
    seen: set[str] = set()
    for pid in ids:
        if pid.startswith("project-"):
            pid = pid[len("project-") :]
        if not UUID_RE.match(pid):
            raise SystemExit(f"invalid project id: {pid!r}")
        if pid not in seen:
            seen.add(pid)
            out.append(pid)
    if args.limit:
        out = out[: args.limit]
    if not out:
        raise SystemExit("no project ids")
    return out


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("project_ids", nargs="*")
    parser.add_argument("--ids-file")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--namespace", default="default")
    parser.add_argument("--archive-bucket", default="kucalc-prod2-archived-projects")
    parser.add_argument("--cluster", default="prod3")
    parser.add_argument("--r2-bucket")
    parser.add_argument("--r2-env-file", default=os.environ.get("R2_ENV_FILE"))
    parser.add_argument("--sidecar-prefix", default="legacy-recovery")
    parser.add_argument("--workdir", default="/var/tmp/archive-to-r2")
    parser.add_argument("--pool", default="archive2r2")
    parser.add_argument("--pool-size", default="300G")
    parser.add_argument("--zstd-level", type=int, default=10)
    parser.add_argument("--zstd-long", type=int, default=27)
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--keep", action="store_true")
    args = parser.parse_args()

    require_tools(["tar", "zstd", "rclone", "bup", "lz4"])
    if not (shutil.which("gsutil") or shutil.which("gcloud")):
        raise SystemExit("missing gsutil or gcloud")

    Path(args.workdir).mkdir(parents=True, exist_ok=True)
    migrator = ArchiveMigrator(args)
    ok = 0
    failed = 0
    try:
        for project_id in read_project_ids(args):
            result = migrator.migrate_one(project_id)
            print(json.dumps(result, sort_keys=True), flush=True)
            if result.get("status") in {"done", "skipped_exists"}:
                ok += 1
            else:
                failed += 1
    finally:
        migrator.close()
    raise SystemExit(0 if failed == 0 else 1)


if __name__ == "__main__":
    main()
