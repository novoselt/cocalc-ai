/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { createHash, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { chmod, mkdir, mkdtemp, rename, rm, stat } from "node:fs/promises";
import { join } from "node:path";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import * as zlib from "node:zlib";

import { data } from "@cocalc/backend/data";
import { envToInt } from "@cocalc/backend/misc/env-to-number";
import type {
  LroRef,
  LegacyProjectArchiveRemediationApplyResult,
  LegacyProjectArchiveRemediationDiffEntry,
  LegacyProjectArchiveRemediationDiffKind,
  LegacyProjectArchiveRemediationResult,
  ProjectArchiveEntry,
  ProjectArchiveRestoreResult,
  SignedProjectArchiveDownload,
} from "@cocalc/conat/files/file-server";
import {
  LEGACY_RESTORE_FILE_FAILURE_REPORT_LIMIT,
  legacyRestoreMissingArchiveEntriesFromTarStderr,
  legacyRestoreTarStderrHasOnlyMissingArchiveEntries,
} from "@cocalc/util/legacy-migration";
import { assertValidSnapshotName } from "@cocalc/util/snapshot-name";
import { publishLroEvent } from "../lro/stream";

import { normalizeArchivePath } from "../archive-path";

const PROJECT_ARCHIVE_RESTORE_TIMEOUT_MS = Math.max(
  60 * 60 * 1000,
  envToInt("COCALC_PROJECT_ARCHIVE_RESTORE_TIMEOUT_MS", 6 * 60 * 60 * 1000),
);
const PROJECT_ARCHIVE_DOWNLOAD_STALL_TIMEOUT_MS = Math.max(
  30 * 1000,
  envToInt("COCALC_PROJECT_ARCHIVE_DOWNLOAD_STALL_TIMEOUT_MS", 2 * 60 * 1000),
);
const PROJECT_ARCHIVE_PROGRESS_INTERVAL_MS = 1000;
const PROJECT_ARCHIVE_MAX_FILE_BYTES = Math.max(
  1,
  envToInt("COCALC_PROJECT_ARCHIVE_MAX_FILE_BYTES", 8 * 1024 * 1024 * 1024),
);
const PROJECT_ARCHIVE_SKIPPED_FILE_REPORT_LIMIT = Math.max(
  0,
  envToInt("COCALC_PROJECT_ARCHIVE_SKIPPED_FILE_REPORT_LIMIT", 100),
);
const LEGACY_PROJECT_REMEDIATION_DIFF_REPORT_LIMIT = Math.max(
  1,
  envToInt("COCALC_LEGACY_PROJECT_REMEDIATION_DIFF_REPORT_LIMIT", 500),
);
const LEGACY_PROJECT_FINAL_ARCHIVE_SNAPSHOT_NAME = "final-cocalc-com-archive";
const LEGACY_PROJECT_ARCHIVE_MANAGED_EXCLUDE_ROOTS = [
  ".cache/cocalc",
  ".local/share/cocalc",
  ".snapshots",
  ".smc",
  ".ssh/.cocalc",
  ".ssh/authorized_keys",
];
const RESTORED_PROJECT_QUOTA_HEADROOM_BYTES =
  Math.max(
    0,
    envToInt("COCALC_LEGACY_PROJECT_RESTORE_QUOTA_HEADROOM_MB", 1024),
  ) * 1_000_000;
const configuredRestoredProjectQuotaMultiplier = Number(
  process.env.COCALC_LEGACY_PROJECT_RESTORE_QUOTA_MULTIPLIER ?? 1.05,
);
const RESTORED_PROJECT_QUOTA_MULTIPLIER = Number.isFinite(
  configuredRestoredProjectQuotaMultiplier,
)
  ? Math.max(1, configuredRestoredProjectQuotaMultiplier)
  : 1.05;

type LegacyProjectArchiveDeps = {
  getOrEnsureVolume: (project_id: string) => Promise<unknown>;
  getProjectQuota?: (project_id: string) => Promise<{
    size: number;
    used: number;
    warning?: string;
  }>;
  setProjectQuota?: (
    project_id: string,
    size: number | string,
  ) => Promise<void>;
  setProjectQuotaGraceActive?: (project_id: string, active: boolean) => void;
  setProjectArchiveRestoreActive?: (
    project_id: string,
    active: boolean,
  ) => void;
  markProjectArchiveInitialBackupExempt?: (project_id: string) => void;
  projectMountpoint: (project_id: string) => string;
  createWritableSnapshot: (source: string, dest: string) => Promise<void>;
  createReadonlySnapshot: (source: string, dest: string) => Promise<void>;
  setSubvolumeReadonly: (path: string, readOnly: boolean) => Promise<void>;
  deleteSubvolumeTree: (path?: string) => Promise<void>;
  invalidateProjectFsServer: (project_id: string) => void;
  touchProjectLastEdited: (project_id: string, reason: string) => void;
  logger: {
    warn: (message: string, metadata?: Record<string, unknown>) => void;
  };
};

function archiveRestoreTmpRoot(): string {
  return join(data, "tmp", "legacy-project-restore");
}

function publishArchiveProgress({
  lro,
  phase,
  message,
  progress,
  detail,
}: {
  lro?: LroRef;
  phase: string;
  message: string;
  progress: number;
  detail?: any;
}): void {
  if (!lro) return;
  void publishLroEvent({
    scope_type: lro.scope_type,
    scope_id: lro.scope_id,
    op_id: lro.op_id,
    event: {
      type: "progress",
      ts: Date.now(),
      phase,
      message,
      progress,
      detail,
    },
  }).catch(() => {});
}

function truncateProgressPath(path: string): string {
  const value = path.trim();
  if (value.length <= 240) return value;
  return `...${value.slice(value.length - 237)}`;
}

function assertSafeArchivePath(raw: string): void {
  const value = raw.trim();
  if (!value || value === ".") return;
  if (value.includes("\0")) {
    throw new Error("archive contains a path with a NUL byte");
  }
  const slashPath = value.replace(/\\/g, "/");
  if (slashPath.split("/").includes("..")) {
    throw new Error(`archive contains a parent-directory path: ${value}`);
  }
  const normalized = path.posix.normalize(slashPath);
  if (path.posix.isAbsolute(value) || path.posix.isAbsolute(normalized)) {
    throw new Error(`archive contains an absolute path: ${value}`);
  }
  const parts = normalized.split("/");
  if (parts.includes("..")) {
    throw new Error(`archive contains a parent-directory path: ${value}`);
  }
}

function normalizeProjectArchiveMemberPath(raw: string): string {
  return normalizeArchivePath(raw).replace(/\/+$/, "");
}

function normalizeProjectArchivePathRoots(
  paths?: string[],
): string[] | undefined {
  const normalized = Array.from(
    new Set(
      (paths ?? [])
        .map((entry) => normalizeProjectArchiveMemberPath(entry))
        .filter(Boolean),
    ),
  );
  return normalized.length > 0 ? normalized : undefined;
}

function restoredProjectQuotaBytes({
  previous_quota_bytes,
  restored_bytes,
}: {
  previous_quota_bytes?: number;
  restored_bytes: number;
}): number {
  const restoredSize = Math.ceil(
    restored_bytes * RESTORED_PROJECT_QUOTA_MULTIPLIER +
      RESTORED_PROJECT_QUOTA_HEADROOM_BYTES,
  );
  return Math.max(previous_quota_bytes ?? 0, restoredSize);
}

function archivePathMatchesRoot(path: string, root: string): boolean {
  return path === root || path.startsWith(`${root}/`);
}

function shouldRestoreArchivePath({
  archivePath,
  exclude,
}: {
  archivePath: string;
  exclude?: string[];
}): boolean {
  const normalized = normalizeProjectArchiveMemberPath(archivePath);
  if (!normalized) return exclude == null;
  if (exclude?.some((root) => archivePathMatchesRoot(normalized, root))) {
    return false;
  }
  return true;
}

function rsyncExcludeArgs(exclude?: string[]): string[] {
  return (exclude ?? []).map((root) => `--exclude=${root}`);
}

function runProjectArchiveTarCommand({
  archivePath,
  args,
  onStdoutLine,
  runAs,
}: {
  archivePath: string;
  args: string[];
  onStdoutLine?: (line: string) => void;
  runAs?: { uid: number; gid: number };
}): Promise<{ stderr: string }> {
  const createZstdDecompress = (zlib as any).createZstdDecompress;
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, {
      gid: runAs?.gid,
      stdio: ["pipe", "pipe", "pipe"],
      uid: runAs?.uid,
    });
    const stdin = child.stdin;
    if (stdin == null) {
      reject(new Error("tar stdin pipe was not created"));
      return;
    }
    let stdoutBuffer = "";
    let stderr = "";
    let settled = false;
    let inputError: Error | undefined;
    let inputStreamClosedEarly = false;
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGTERM");
      reject(new Error("tar command timed out"));
    }, PROJECT_ARCHIVE_RESTORE_TIMEOUT_MS);
    timeout.unref?.();

    child.stdout.on("data", (chunk) => {
      if (onStdoutLine == null) return;
      stdoutBuffer += chunk.toString("utf8");
      const lines = stdoutBuffer.split(/\r?\n/g);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        try {
          onStdoutLine(line);
        } catch (err) {
          inputError = err instanceof Error ? err : new Error(`${err}`);
          child.kill("SIGTERM");
          return;
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
      if (stderr.length > 20_000) {
        stderr = stderr.slice(stderr.length - 20_000);
      }
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      reject(err);
    });
    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      if (stdoutBuffer && onStdoutLine != null && inputError == null) {
        try {
          onStdoutLine(stdoutBuffer);
        } catch (err) {
          inputError = err instanceof Error ? err : new Error(`${err}`);
        }
      }
      if (code !== 0) {
        const error = new Error(
          `tar failed with code ${code ?? "null"} signal ${signal ?? "null"}: ${stderr.trim() || inputError?.message || "unknown error"}`,
        );
        (error as any).tarStderr = stderr;
        (error as any).tarCode = code;
        (error as any).tarSignal = signal;
        reject(error);
        return;
      }
      if (inputError) {
        reject(inputError);
        return;
      }
      if (inputStreamClosedEarly && code !== 0) {
        reject(new Error("archive input stream closed before tar completed"));
        return;
      }
      resolve({ stderr });
    });

    const failInput = (err: unknown) => {
      if (settled) return;
      const error = err instanceof Error ? err : new Error(`${err}`);
      if (
        (error as any).code === "ERR_STREAM_PREMATURE_CLOSE" ||
        error.message === "Premature close"
      ) {
        inputStreamClosedEarly = true;
        return;
      }
      inputError ??= error;
      child.kill("SIGTERM");
    };
    if (typeof createZstdDecompress !== "function") {
      failInput(
        new Error(
          "Node runtime does not provide zstd decompression for project archive restore",
        ),
      );
      return;
    }
    const decompressor = createZstdDecompress();
    pipeline(createReadStream(archivePath), decompressor, stdin).catch(
      failInput,
    );
  });
}

function parseTarVerboseLine(line: string):
  | {
      path: string;
      size: number;
      type: ProjectArchiveEntry["type"];
      mtime?: string;
    }
  | undefined {
  const match = line.match(
    /^(\S+)\s+\S+\s+(\d+)\s+(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}(?::\d{2})?)\s+(.+)$/,
  );
  if (!match) return;
  const size = Number(match[2]);
  if (!Number.isFinite(size) || size < 0) return;
  const mode = match[1];
  const name = match[5]
    .replace(/\s+->\s+.*$/, "")
    .replace(/\s+link to\s+.*$/, "");
  const kind = mode[0];
  const type =
    kind === "d"
      ? "directory"
      : kind === "l"
        ? "symlink"
        : kind === "-"
          ? "file"
          : "other";
  return { path: name, size, type, mtime: `${match[3]}T${match[4]}Z` };
}

async function scanProjectArchiveTar({
  archivePath,
  exclude,
  member_list_path,
  max_uncompressed_bytes,
  lro,
}: {
  archivePath: string;
  exclude?: string[];
  member_list_path?: string;
  max_uncompressed_bytes?: number;
  lro?: LroRef;
}): Promise<{
  file_count: number;
  uncompressed_bytes: number;
  skipped_file_count: number;
  skipped_bytes: number;
  skipped_files: ProjectArchiveEntry[];
}> {
  let file_count = 0;
  let uncompressed_bytes = 0;
  let skipped_file_count = 0;
  let skipped_bytes = 0;
  const skipped_files: ProjectArchiveEntry[] = [];
  const memberList =
    member_list_path != null ? createWriteStream(member_list_path) : undefined;
  let lastProgress = 0;
  const closeMemberList = async () => {
    if (memberList == null) return;
    await new Promise<void>((resolve, reject) => {
      const onError = (err: Error) => reject(err);
      memberList.once("error", onError);
      memberList.end(() => {
        memberList.off("error", onError);
        resolve();
      });
    });
  };
  try {
    await runProjectArchiveTarCommand({
      archivePath,
      // The member list is fed back to tar -T; keep backslashes literal.
      args: ["--quoting-style=literal", "-tvf", "-"],
      onStdoutLine: (line) => {
        const parsed = parseTarVerboseLine(line);
        if (parsed == null) {
          if (line.trim()) {
            throw new Error(`unable to parse tar listing line: ${line}`);
          }
          return;
        }
        assertSafeArchivePath(parsed.path);
        if (
          !shouldRestoreArchivePath({
            archivePath: parsed.path,
            exclude,
          })
        ) {
          return;
        }
        const normalized = normalizeProjectArchiveMemberPath(parsed.path);
        if (
          parsed.type === "file" &&
          parsed.size > PROJECT_ARCHIVE_MAX_FILE_BYTES
        ) {
          skipped_file_count += 1;
          skipped_bytes += parsed.size;
          if (
            PROJECT_ARCHIVE_SKIPPED_FILE_REPORT_LIMIT === 0 ||
            skipped_files.length < PROJECT_ARCHIVE_SKIPPED_FILE_REPORT_LIMIT
          ) {
            skipped_files.push({
              path: normalized,
              size: parsed.size,
              type: parsed.type,
              mtime: parsed.mtime,
            });
          }
          return;
        }
        if (parsed.path.trim()) {
          file_count += 1;
          memberList?.write(`${parsed.path}\n`);
        }
        uncompressed_bytes += parsed.size;
        const now = Date.now();
        if (now - lastProgress >= PROJECT_ARCHIVE_PROGRESS_INTERVAL_MS) {
          lastProgress = now;
          publishArchiveProgress({
            lro,
            phase: "scan",
            message: "checking archive contents",
            progress: 55,
            detail: {
              file_count,
              uncompressed_bytes,
              skipped_file_count,
              skipped_bytes,
            },
          });
        }
        if (
          max_uncompressed_bytes != null &&
          uncompressed_bytes > max_uncompressed_bytes
        ) {
          throw new Error(
            `legacy project archive is too large for current storage quota (${uncompressed_bytes} > ${max_uncompressed_bytes} bytes)`,
          );
        }
      },
    });
  } finally {
    await closeMemberList();
  }
  return {
    file_count,
    uncompressed_bytes,
    skipped_file_count,
    skipped_bytes,
    skipped_files,
  };
}

async function extractProjectArchiveTar({
  archivePath,
  dest,
  owner,
  member_list_path,
  expected_file_count,
  expected_uncompressed_bytes,
  lro,
}: {
  archivePath: string;
  dest: string;
  owner: { uid: number; gid: number };
  member_list_path?: string;
  expected_file_count?: number;
  expected_uncompressed_bytes?: number;
  lro?: LroRef;
}): Promise<{ missing_archive_files: string[] }> {
  publishArchiveProgress({
    lro,
    phase: "extract",
    message: "extracting archive files",
    progress: 70,
  });
  const args = [
    "--delay-directory-restore",
    "--no-same-owner",
    "--no-overwrite-dir",
    "--no-wildcards",
    "-xvf",
    "-",
    "-C",
    dest,
  ];
  if (member_list_path != null) {
    args.push(
      "--verbatim-files-from",
      "--no-recursion",
      "-T",
      member_list_path,
    );
  }
  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : undefined;
  const runAs = currentUid === owner.uid ? undefined : owner;
  let extracted_count = 0;
  let lastProgress = 0;
  try {
    await runProjectArchiveTarCommand({
      archivePath,
      args,
      runAs,
      onStdoutLine: (line) => {
        const path = normalizeProjectArchiveMemberPath(line);
        if (!path) return;
        assertSafeArchivePath(path);
        extracted_count += 1;
        const now = Date.now();
        if (now - lastProgress < PROJECT_ARCHIVE_PROGRESS_INTERVAL_MS) return;
        lastProgress = now;
        const progress =
          expected_file_count != null && expected_file_count > 0
            ? Math.min(88, 70 + (extracted_count / expected_file_count) * 18)
            : 75;
        publishArchiveProgress({
          lro,
          phase: "extract",
          message: "extracting archive files",
          progress,
          detail: {
            current_path: truncateProgressPath(path),
            extracted_count,
            file_count: expected_file_count,
            uncompressed_bytes: expected_uncompressed_bytes,
          },
        });
      },
    });
    return { missing_archive_files: [] };
  } catch (err) {
    const stderr = (err as any)?.tarStderr;
    const missing = legacyRestoreMissingArchiveEntriesFromTarStderr(stderr);
    if (
      missing.length > 0 &&
      legacyRestoreTarStderrHasOnlyMissingArchiveEntries(stderr)
    ) {
      publishArchiveProgress({
        lro,
        phase: "extract",
        message: "archive extracted with file warnings",
        progress: 90,
        detail: {
          extracted_count,
          file_count: expected_file_count,
          uncompressed_bytes: expected_uncompressed_bytes,
          missing_archive_file_count: missing.length,
          missing_archive_files: missing.slice(
            0,
            LEGACY_RESTORE_FILE_FAILURE_REPORT_LIMIT,
          ),
        },
      });
      return { missing_archive_files: missing };
    }
    throw err;
  }
}

async function downloadSignedProjectArchive({
  download,
  dest,
  lro,
}: {
  download: SignedProjectArchiveDownload;
  dest: string;
  lro?: LroRef;
}): Promise<{ bytes: number; sha256: string }> {
  const controller = new AbortController();
  const hash = createHash("sha256");
  const expectedBytes =
    typeof download.bytes === "number" && Number.isFinite(download.bytes)
      ? download.bytes
      : undefined;
  let bytes = 0;
  let lastProgress = 0;
  let stallError: Error | undefined;
  let stallTimer: NodeJS.Timeout | undefined;
  const resetStallTimer = () => {
    if (stallTimer != null) {
      clearTimeout(stallTimer);
    }
    stallTimer = setTimeout(() => {
      stallError = new Error(
        `project archive download stalled after ${PROJECT_ARCHIVE_DOWNLOAD_STALL_TIMEOUT_MS}ms with ${bytes}${expectedBytes != null ? `/${expectedBytes}` : ""} bytes downloaded`,
      );
      controller.abort(stallError);
    }, PROJECT_ARCHIVE_DOWNLOAD_STALL_TIMEOUT_MS);
    stallTimer.unref?.();
  };
  resetStallTimer();
  const monitor = new Transform({
    transform(chunk: Buffer, _encoding, cb) {
      bytes += chunk.length;
      hash.update(chunk);
      resetStallTimer();
      const now = Date.now();
      if (now - lastProgress >= PROJECT_ARCHIVE_PROGRESS_INTERVAL_MS) {
        lastProgress = now;
        publishArchiveProgress({
          lro,
          phase: "download",
          message: "downloading archive",
          progress:
            expectedBytes != null && expectedBytes > 0
              ? Math.min(45, 20 + (bytes / expectedBytes) * 25)
              : 30,
          detail: {
            bytes,
            expected_bytes: expectedBytes,
          },
        });
      }
      cb(null, chunk);
    },
  });
  try {
    const response = await fetch(download.url, {
      headers: download.headers ?? {},
      signal: controller.signal,
    });
    if (!response.ok || !response.body) {
      throw new Error(
        `project archive download failed (${response.status}): ${response.statusText || "unknown error"}`,
      );
    }
    await pipeline(
      Readable.fromWeb(response.body as NodeReadableStream),
      monitor,
      createWriteStream(dest),
    );
  } catch (err) {
    if (stallError != null) {
      throw stallError;
    }
    throw err;
  } finally {
    if (stallTimer != null) {
      clearTimeout(stallTimer);
    }
  }
  const sha256 = hash.digest("hex");
  const expectedSha256 = `${download.sha256 ?? ""}`.trim().toLowerCase();
  if (expectedSha256 && sha256 !== expectedSha256) {
    throw new Error(
      `project archive sha256 mismatch: expected ${expectedSha256}, got ${sha256}`,
    );
  }
  return { bytes, sha256 };
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (err: any) {
    if (err?.code === "ENOENT") return false;
    throw err;
  }
}

function slashDir(path: string): string {
  return path.endsWith("/") ? path : `${path}/`;
}

function emptyDiffCounts(): Record<
  LegacyProjectArchiveRemediationDiffKind,
  number
> {
  return { add: 0, update: 0, delete: 0, other: 0 };
}

function parseRsyncItemizedLine(
  line: string,
): LegacyProjectArchiveRemediationDiffEntry | undefined {
  if (!line.trim()) return;
  const tab = line.indexOf("\t");
  const itemized = tab >= 0 ? line.slice(0, tab) : line.slice(0, 11);
  const rawPath = tab >= 0 ? line.slice(tab + 1) : line.slice(12);
  const normalizedPath = normalizeProjectArchiveMemberPath(rawPath);
  if (!normalizedPath) return;
  const kind: LegacyProjectArchiveRemediationDiffKind = itemized.startsWith(
    "*deleting",
  )
    ? "delete"
    : itemized.includes("+++++++++")
      ? "add"
      : itemized[0] === ">" || itemized[0] === "c"
        ? "update"
        : "other";
  return { path: normalizedPath, kind, itemized: itemized.trim() };
}

async function runRsyncItemized({ args }: { args: string[] }): Promise<{
  counts: Record<LegacyProjectArchiveRemediationDiffKind, number>;
  files: LegacyProjectArchiveRemediationDiffEntry[];
  file_count: number;
  truncated: boolean;
}> {
  const counts = emptyDiffCounts();
  const files: LegacyProjectArchiveRemediationDiffEntry[] = [];
  let file_count = 0;
  await new Promise<void>((resolve, reject) => {
    const child = spawn("rsync", args, {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
      let idx: number;
      while ((idx = stdout.indexOf("\n")) >= 0) {
        const line = stdout.slice(0, idx);
        stdout = stdout.slice(idx + 1);
        const parsed = parseRsyncItemizedLine(line);
        if (parsed == null) continue;
        file_count += 1;
        counts[parsed.kind] += 1;
        if (files.length < LEGACY_PROJECT_REMEDIATION_DIFF_REPORT_LIMIT) {
          files.push(parsed);
        }
      }
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      for (const line of stdout.split(/\r?\n/g)) {
        const parsed = parseRsyncItemizedLine(line);
        if (parsed == null) continue;
        file_count += 1;
        counts[parsed.kind] += 1;
        if (files.length < LEGACY_PROJECT_REMEDIATION_DIFF_REPORT_LIMIT) {
          files.push(parsed);
        }
      }
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `rsync failed with exit code ${code}${stderr ? `: ${stderr}` : ""}`,
        ),
      );
    });
  });
  return {
    counts,
    files,
    file_count,
    truncated: file_count > files.length,
  };
}

async function createSelectedMemberList({
  project_id,
  archivePath,
  exclude,
  max_uncompressed_bytes,
  lro,
}: {
  project_id: string;
  archivePath: string;
  exclude?: string[];
  max_uncompressed_bytes?: number;
  lro?: LroRef;
}): Promise<{
  memberListTmpDir: string;
  member_list_path: string;
  file_count: number;
  uncompressed_bytes: number;
  skipped_file_count: number;
  skipped_bytes: number;
  skipped_files: ProjectArchiveEntry[];
}> {
  const tmpRoot = archiveRestoreTmpRoot();
  await mkdir(tmpRoot, { recursive: true });
  const memberListTmpDir = await mkdtemp(join(tmpRoot, `${project_id}-list-`));
  await chmod(memberListTmpDir, 0o711);
  const member_list_path = join(memberListTmpDir, "selected-members.txt");
  const scan = await scanProjectArchiveTar({
    archivePath,
    exclude,
    member_list_path,
    max_uncompressed_bytes,
    lro,
  });
  if (exclude != null && scan.file_count === 0) {
    throw new Error("legacy project archive matched no restorable files");
  }
  await chmod(member_list_path, 0o644);
  return { memberListTmpDir, member_list_path, ...scan };
}

function defaultSafetySnapshotName(): string {
  return `before-final-cocalc-com-safe-restore-${new Date().toISOString()}`;
}

export function createLegacyProjectArchiveHandlers({
  getOrEnsureVolume,
  getProjectQuota,
  setProjectQuota,
  setProjectQuotaGraceActive,
  setProjectArchiveRestoreActive,
  markProjectArchiveInitialBackupExempt,
  projectMountpoint,
  createWritableSnapshot,
  createReadonlySnapshot,
  setSubvolumeReadonly,
  deleteSubvolumeTree,
  invalidateProjectFsServer,
  touchProjectLastEdited,
  logger,
}: LegacyProjectArchiveDeps): {
  restoreProjectArchive: (opts: {
    project_id: string;
    download: SignedProjectArchiveDownload;
    max_uncompressed_bytes?: number;
    temporary_quota_grace?: boolean;
    lro?: LroRef;
  }) => Promise<ProjectArchiveRestoreResult>;
  prepareLegacyProjectArchiveRemediation: (opts: {
    project_id: string;
    download: SignedProjectArchiveDownload;
    snapshot_name?: string;
    max_uncompressed_bytes?: number;
    lro?: LroRef;
  }) => Promise<LegacyProjectArchiveRemediationResult>;
  applyLegacyProjectArchiveRemediation: (opts: {
    project_id: string;
    snapshot_name?: string;
    safety_snapshot_name?: string;
    lro?: LroRef;
  }) => Promise<LegacyProjectArchiveRemediationApplyResult>;
} {
  return {
    async prepareLegacyProjectArchiveRemediation({
      project_id,
      download,
      snapshot_name = LEGACY_PROJECT_FINAL_ARCHIVE_SNAPSHOT_NAME,
      max_uncompressed_bytes,
      lro,
    }: {
      project_id: string;
      download: SignedProjectArchiveDownload;
      snapshot_name?: string;
      max_uncompressed_bytes?: number;
      lro?: LroRef;
    }): Promise<LegacyProjectArchiveRemediationResult> {
      const started = Date.now();
      snapshot_name = assertValidSnapshotName(snapshot_name);
      await getOrEnsureVolume(project_id);
      const home = projectMountpoint(project_id);
      const snapshotsDir = join(home, ".snapshots");
      const finalSnapshotPath = join(snapshotsDir, snapshot_name);
      let tmpDir: string | undefined;
      let memberListTmpDir: string | undefined;
      let workSnapshotPath: string | undefined;
      const exclude = normalizeProjectArchivePathRoots(
        LEGACY_PROJECT_ARCHIVE_MANAGED_EXCLUDE_ROOTS,
      );
      const rsyncExclude = rsyncExcludeArgs(exclude);
      let downloaded: { bytes: number; sha256: string } | undefined;
      let scan:
        | {
            file_count: number;
            uncompressed_bytes: number;
            skipped_file_count: number;
            skipped_bytes: number;
            skipped_files: ProjectArchiveEntry[];
          }
        | undefined;
      let missingArchiveFiles: string[] = [];
      try {
        setProjectArchiveRestoreActive?.(project_id, true);
        await mkdir(snapshotsDir, { recursive: true });
        if (!(await pathExists(finalSnapshotPath))) {
          const tmpRoot = archiveRestoreTmpRoot();
          await mkdir(tmpRoot, { recursive: true });
          tmpDir = await mkdtemp(join(tmpRoot, `${project_id}-remediation-`));
          const archivePath = join(tmpDir, "project.tar.zst");
          const extractedPath = join(tmpDir, "extracted");
          await mkdir(extractedPath, { recursive: true });
          downloaded = await downloadSignedProjectArchive({
            download,
            dest: archivePath,
            lro,
          });
          const selected = await createSelectedMemberList({
            project_id,
            archivePath,
            exclude,
            max_uncompressed_bytes,
            lro,
          });
          memberListTmpDir = selected.memberListTmpDir;
          scan = selected;
          const homeStat = await stat(home);
          const extraction = await extractProjectArchiveTar({
            archivePath,
            dest: extractedPath,
            owner: { uid: homeStat.uid, gid: homeStat.gid },
            member_list_path: selected.member_list_path,
            expected_file_count: selected.file_count,
            expected_uncompressed_bytes: selected.uncompressed_bytes,
            lro,
          });
          missingArchiveFiles = extraction.missing_archive_files;
          workSnapshotPath = join(
            snapshotsDir,
            `.final-cocalc-com-archive-work-${randomUUID()}`,
          );
          await createWritableSnapshot(home, workSnapshotPath);
          await rm(join(workSnapshotPath, ".snapshots"), {
            recursive: true,
            force: true,
          });
          await runRsyncItemized({
            args: [
              "-a",
              "--delete",
              ...rsyncExclude,
              slashDir(extractedPath),
              slashDir(workSnapshotPath),
            ],
          });
          await setSubvolumeReadonly(workSnapshotPath, true);
          await rename(workSnapshotPath, finalSnapshotPath);
          workSnapshotPath = undefined;
        }
        const diff = await runRsyncItemized({
          args: [
            "-ani",
            "--delete",
            ...rsyncExclude,
            slashDir(finalSnapshotPath),
            slashDir(home),
          ],
        });
        return {
          snapshot_name,
          snapshot_path: `.snapshots/${snapshot_name}`,
          diff_counts: diff.counts,
          diff_files: diff.files,
          diff_file_count: diff.file_count,
          truncated: diff.truncated,
          file_count: scan?.file_count,
          uncompressed_bytes: scan?.uncompressed_bytes,
          skipped_file_count: scan?.skipped_file_count,
          skipped_bytes: scan?.skipped_bytes,
          missing_archive_file_count: missingArchiveFiles.length,
          missing_archive_files: missingArchiveFiles.slice(
            0,
            LEGACY_RESTORE_FILE_FAILURE_REPORT_LIMIT,
          ),
          bytes: downloaded?.bytes,
          sha256: downloaded?.sha256,
          duration_ms: Date.now() - started,
        };
      } finally {
        setProjectArchiveRestoreActive?.(project_id, false);
        await deleteSubvolumeTree(workSnapshotPath).catch(() => {});
        if (memberListTmpDir) {
          await rm(memberListTmpDir, { recursive: true, force: true }).catch(
            () => {},
          );
        }
        if (tmpDir) {
          await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
        }
      }
    },

    async applyLegacyProjectArchiveRemediation({
      project_id,
      snapshot_name = LEGACY_PROJECT_FINAL_ARCHIVE_SNAPSHOT_NAME,
      safety_snapshot_name = defaultSafetySnapshotName(),
      lro: _lro,
    }: {
      project_id: string;
      snapshot_name?: string;
      safety_snapshot_name?: string;
      lro?: LroRef;
    }): Promise<LegacyProjectArchiveRemediationApplyResult> {
      const started = Date.now();
      snapshot_name = assertValidSnapshotName(snapshot_name);
      safety_snapshot_name = assertValidSnapshotName(safety_snapshot_name);
      await getOrEnsureVolume(project_id);
      const home = projectMountpoint(project_id);
      const finalSnapshotPath = join(home, ".snapshots", snapshot_name);
      if (!(await pathExists(finalSnapshotPath))) {
        throw new Error(
          `final archive snapshot does not exist: ${snapshot_name}`,
        );
      }
      const safetySnapshotPath = join(home, ".snapshots", safety_snapshot_name);
      if (await pathExists(safetySnapshotPath)) {
        throw new Error(
          `safety snapshot already exists: ${safety_snapshot_name}`,
        );
      }
      const exclude = normalizeProjectArchivePathRoots(
        LEGACY_PROJECT_ARCHIVE_MANAGED_EXCLUDE_ROOTS,
      );
      const rsyncExclude = rsyncExcludeArgs(exclude);
      try {
        setProjectArchiveRestoreActive?.(project_id, true);
        await createReadonlySnapshot(home, safetySnapshotPath);
        const applied = await runRsyncItemized({
          args: [
            "-ai",
            "--update",
            ...rsyncExclude,
            slashDir(finalSnapshotPath),
            slashDir(home),
          ],
        });
        invalidateProjectFsServer(project_id);
        void touchProjectLastEdited(
          project_id,
          "legacy-migration-safe-restore",
        );
        return {
          snapshot_name,
          safety_snapshot_name,
          applied_counts: applied.counts,
          applied_files: applied.files,
          applied_file_count: applied.file_count,
          truncated: applied.truncated,
          duration_ms: Date.now() - started,
        };
      } finally {
        setProjectArchiveRestoreActive?.(project_id, false);
      }
    },

    async restoreProjectArchive({
      project_id,
      download,
      max_uncompressed_bytes,
      temporary_quota_grace,
      lro,
    }: {
      project_id: string;
      download: SignedProjectArchiveDownload;
      max_uncompressed_bytes?: number;
      temporary_quota_grace?: boolean;
      lro?: LroRef;
    }): Promise<ProjectArchiveRestoreResult> {
      const started = Date.now();
      await getOrEnsureVolume(project_id);
      const home = projectMountpoint(project_id);
      let tmpDir: string | undefined;
      let memberListTmpDir: string | undefined;
      let archivePath: string;
      let savedQuotaSize: number | undefined;
      let quotaSizeToRestore: number | undefined;
      let quotaGraceEnabled = false;
      let quotaGraceMarkedActive = false;
      const tmpRoot = archiveRestoreTmpRoot();
      await mkdir(tmpRoot, { recursive: true });
      tmpDir = await mkdtemp(join(tmpRoot, `${project_id}-`));
      archivePath = join(tmpDir, "project.tar.zst");
      try {
        setProjectArchiveRestoreActive?.(project_id, true);
        const downloaded = await downloadSignedProjectArchive({
          download,
          dest: archivePath,
          lro,
        });
        if (temporary_quota_grace) {
          if (getProjectQuota == null || setProjectQuota == null) {
            throw new Error(
              "legacy project archive restore requested quota grace without quota helpers",
            );
          } else {
            try {
              setProjectQuotaGraceActive?.(project_id, true);
              quotaGraceMarkedActive = true;
              const quota = await getProjectQuota(project_id);
              if (quota.size > 0) {
                savedQuotaSize = quota.size;
                quotaSizeToRestore = savedQuotaSize;
                publishArchiveProgress({
                  lro,
                  phase: "quota",
                  message: "temporarily lifting project quota for migration",
                  progress: 47,
                  detail: {
                    previous_quota_bytes: quota.size,
                    used_bytes: quota.used,
                    warning: quota.warning,
                  },
                });
                await setProjectQuota(project_id, "none");
                quotaGraceEnabled = true;
              }
            } catch (err) {
              logger.warn(
                "legacy project archive restore failed to enable quota grace",
                { project_id, err: `${err}` },
              );
              throw err;
            }
          }
        }
        const exclude = normalizeProjectArchivePathRoots(
          LEGACY_PROJECT_ARCHIVE_MANAGED_EXCLUDE_ROOTS,
        );
        let member_list_path: string | undefined;
        if (exclude != null) {
          const tmpRoot = archiveRestoreTmpRoot();
          await mkdir(tmpRoot, { recursive: true });
          memberListTmpDir = await mkdtemp(
            join(tmpRoot, `${project_id}-list-`),
          );
          // The tar extractor runs as the project volume owner. Keep only the
          // member list readable/traversable by that user; the archive itself
          // is still streamed over stdin from the project-host process.
          await chmod(memberListTmpDir, 0o711);
          member_list_path = join(memberListTmpDir, "selected-members.txt");
        }
        const {
          file_count,
          uncompressed_bytes,
          skipped_file_count,
          skipped_bytes,
          skipped_files,
        } = await scanProjectArchiveTar({
          archivePath,
          exclude,
          member_list_path,
          max_uncompressed_bytes,
          lro,
        });
        if (exclude != null && file_count === 0) {
          throw new Error("legacy project archive matched no restorable files");
        }
        if (member_list_path != null) {
          await chmod(member_list_path, 0o644);
        }
        const homeStat = await stat(home);
        const extraction = await extractProjectArchiveTar({
          archivePath,
          dest: home,
          owner: { uid: homeStat.uid, gid: homeStat.gid },
          member_list_path,
          expected_file_count: file_count,
          expected_uncompressed_bytes: uncompressed_bytes,
          lro,
        });
        const missingArchiveFiles = extraction.missing_archive_files;
        let quotaUsedBytes: number | undefined;
        let quotaSizeBytes: number | undefined;
        if (quotaGraceEnabled) {
          try {
            const quota = await getProjectQuota?.(project_id);
            quotaUsedBytes = quota?.used;
            quotaSizeBytes = quota?.size;
          } catch (err) {
            logger.warn(
              "legacy project archive restore failed to read post-restore quota",
              { project_id, err: `${err}` },
            );
          }
          const restoredBytes = Math.max(
            uncompressed_bytes,
            quotaUsedBytes ?? 0,
          );
          quotaSizeToRestore = restoredProjectQuotaBytes({
            previous_quota_bytes: savedQuotaSize,
            restored_bytes: restoredBytes,
          });
        }
        publishArchiveProgress({
          lro,
          phase: "finish",
          message: "legacy project files restored",
          progress: 95,
          detail: {
            file_count,
            uncompressed_bytes,
            skipped_file_count,
            skipped_bytes,
            skipped_files,
            missing_archive_file_count: missingArchiveFiles.length,
            missing_archive_files: missingArchiveFiles.slice(
              0,
              LEGACY_RESTORE_FILE_FAILURE_REPORT_LIMIT,
            ),
          },
        });
        invalidateProjectFsServer(project_id);
        markProjectArchiveInitialBackupExempt?.(project_id);
        void touchProjectLastEdited(project_id, "legacy-migration-restore");
        return {
          ...downloaded,
          file_count,
          uncompressed_bytes,
          quota_used_bytes: quotaUsedBytes,
          quota_size_bytes: quotaSizeToRestore ?? quotaSizeBytes,
          skipped_file_count,
          skipped_bytes,
          skipped_files,
          missing_archive_file_count: missingArchiveFiles.length,
          missing_archive_files: missingArchiveFiles.slice(
            0,
            LEGACY_RESTORE_FILE_FAILURE_REPORT_LIMIT,
          ),
          duration_ms: Date.now() - started,
        };
      } finally {
        setProjectArchiveRestoreActive?.(project_id, false);
        if (quotaGraceEnabled && quotaSizeToRestore != null) {
          try {
            await setProjectQuota?.(project_id, quotaSizeToRestore);
            publishArchiveProgress({
              lro,
              phase: "quota",
              message: "set project quota after migration",
              progress: 98,
              detail: {
                quota_bytes: quotaSizeToRestore,
              },
            });
          } catch (err) {
            logger.warn(
              "legacy project archive restore failed to restore project quota",
              { project_id, quotaSizeToRestore, err: `${err}` },
            );
          }
        }
        if (quotaGraceMarkedActive) {
          setProjectQuotaGraceActive?.(project_id, false);
        }
        if (tmpDir) {
          await rm(tmpDir, { recursive: true, force: true }).catch((err) => {
            logger.warn("legacy project archive temp cleanup failed", {
              project_id,
              tmpDir,
              err: `${err}`,
            });
          });
        }
        if (memberListTmpDir) {
          await rm(memberListTmpDir, { recursive: true, force: true }).catch(
            (err) => {
              logger.warn("legacy project archive member-list cleanup failed", {
                project_id,
                memberListTmpDir,
                err: `${err}`,
              });
            },
          );
        }
      }
    },
  };
}
