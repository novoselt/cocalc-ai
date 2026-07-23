/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { createHash } from "node:crypto";

import getPool from "@cocalc/database/pool";
import type {
  AdminCrashLocalReadRequest,
  AdminCrashLocalReadResponse,
  AdminCrashLocalResolutionRequest,
  AdminCrashLocalResolutionResponse,
  AdminCrashReport,
  AdminCrashResolution,
  AdminCrashStatus,
} from "@cocalc/conat/hub/api/admin-crashes";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { isValidUUID } from "@cocalc/util/misc";

const DEFAULT_SINCE_MINUTES = 24 * 60;
const MAX_SINCE_MINUTES = 30 * 24 * 60;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2_000;
const SOURCE_LIMIT_MULTIPLIER = 4;
const MAX_MESSAGE_CHARS = 2_000;
const MAX_DETAIL_CHARS = 50_000;
const MAX_NOTE_CHARS = 2_000;

type CrashRow = {
  id: string;
  account_id: string | null;
  name: string | null;
  message: string | null;
  comment: string | null;
  stacktrace: string | null;
  file: string | null;
  line_number: number | null;
  column_number: number | null;
  severity: string | null;
  browser: string | null;
  mobile: boolean | null;
  responsive: boolean | null;
  user_agent: string | null;
  path: string | null;
  smc_version: string | null;
  build_date: string | null;
  smc_git_rev: string | null;
  uptime: string | null;
  start_time: Date | string | null;
  time: Date | string;
};

type ResolutionRow = {
  signature: string;
  build_key: string;
  status: string;
  report_id: string;
  resolved_by: string;
  note: string | null;
  resolved_at: Date | string | null;
};

function positiveInt(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(value ?? fallback));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

function truncate(value: unknown, maxChars: number): string {
  const text = `${value ?? ""}`;
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - 20))}\n[TRUNCATED]`;
}

function hashFingerprint(namespace: string, value: string): string {
  return `${namespace}_${createHash("sha256")
    .update(`${namespace}\0${value}`)
    .digest("hex")
    .slice(0, 16)}`;
}

function sanitizeUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = "";
    url.password = "";
    url.hash = "";
    if (url.search) url.search = "?REDACTED";
    const projectMatch = url.pathname.match(
      /^(.*\/projects\/[0-9a-f-]{36})(?:\/.*)?$/i,
    );
    if (projectMatch) url.pathname = `${projectMatch[1]}/[REDACTED_PATH]`;
    return url.toString();
  } catch {
    return "[REDACTED_URL]";
  }
}

export function redactCrashText(value: unknown, maxChars: number): string {
  let text = `${value ?? ""}`;
  text = text.replace(/https?:\/\/[^\s<>"']+/gi, (url) => sanitizeUrl(url));
  text = text.replace(
    /\b(account[_ -]?id)\s*[:=]\s*["']?[0-9a-f-]{36}["']?/gi,
    "$1=[REDACTED_ACCOUNT_ID]",
  );
  text = text.replace(
    /\b(authorization|api[_ -]?key|access[_ -]?token|password|passwd|secret)\b\s*[:=]\s*[^\s,;]+/gi,
    "$1=[REDACTED_SECRET]",
  );
  text = text.replace(
    /\b(?:sk|rk|ghp|github_pat|xox[baprs])[-_][A-Za-z0-9_-]{12,}\b/g,
    "[REDACTED_TOKEN]",
  );
  text = text.replace(
    /\b[A-Z0-9+/_-]*\.[A-Z0-9+/_-]+\.[A-Z0-9+/_-]+\b/gi,
    "[REDACTED_TOKEN]",
  );
  text = text.replace(
    /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
    "[REDACTED_EMAIL]",
  );
  text = text.replace(/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "[REDACTED_IP]");
  return truncate(text, maxChars);
}

function normalizeSignaturePart(value: unknown): string {
  return `${value ?? ""}`
    .replace(/https?:\/\/[^\s)]+/gi, "[URL]")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "[UUID]")
    .replace(/\b[0-9a-f]{16,}\b/gi, "[HASH]")
    .replace(/\b\d{6,}\b/g, "[NUMBER]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 1_000);
}

function firstStackFrame(stacktrace: unknown): string {
  const lines = `${stacktrace ?? ""}`
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  return (
    lines.find((line) => /^at\s|@https?:|^https?:/.test(line)) ?? lines[1] ?? ""
  );
}

export function crashSignature(input: {
  name?: unknown;
  message?: unknown;
  stacktrace?: unknown;
}): { signature: string; label: string } {
  const name = normalizeSignaturePart(input.name) || "Error";
  const message = normalizeSignaturePart(input.message) || "<no message>";
  const frame = normalizeSignaturePart(firstStackFrame(input.stacktrace));
  const normalized = [name, message, frame].join("\0");
  return {
    signature: hashFingerprint("crash", normalized),
    label: truncate(`${name}: ${message}${frame ? ` @ ${frame}` : ""}`, 500),
  };
}

export function crashBuildKey(input: {
  smc_git_rev?: unknown;
  build_date?: unknown;
  smc_version?: unknown;
}): string {
  const revision = `${input.smc_git_rev ?? ""}`.trim();
  if (revision) return `rev:${revision}`;
  const buildDate = `${input.build_date ?? ""}`.trim();
  if (buildDate) return `date:${buildDate}`;
  const version = `${input.smc_version ?? ""}`.trim();
  return version ? `version:${version}` : "unknown";
}

function iso(value: Date | string | null | undefined): string | null {
  if (value == null) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function resolutionFromRow(
  row: ResolutionRow | undefined,
): AdminCrashResolution | null {
  if (!row || row.status !== "solved") return null;
  return {
    status: "solved",
    report_id: row.report_id,
    resolved_at: iso(row.resolved_at) ?? "",
    resolved_by_fingerprint: hashFingerprint("account", row.resolved_by),
    note: redactCrashText(row.note, MAX_NOTE_CHARS),
  };
}

function reportFromRow({
  row,
  bayId,
  resolution,
  includeDetails,
}: {
  row: CrashRow;
  bayId: string;
  resolution?: ResolutionRow;
  includeDetails: boolean;
}): AdminCrashReport {
  const { signature, label } = crashSignature(row);
  return {
    id: row.id,
    bay_id: bayId,
    time: iso(row.time) ?? "",
    name: redactCrashText(row.name, 500),
    message: redactCrashText(row.message, MAX_MESSAGE_CHARS),
    severity: redactCrashText(row.severity, 100),
    signature,
    signature_label: redactCrashText(label, 500),
    build_key: crashBuildKey(row),
    smc_git_rev: redactCrashText(row.smc_git_rev, 200),
    smc_version: redactCrashText(row.smc_version, 200),
    build_date: redactCrashText(row.build_date, 200),
    browser: redactCrashText(row.browser, 500),
    mobile: row.mobile,
    responsive: row.responsive,
    path: redactCrashText(row.path, 2_000),
    file: redactCrashText(row.file, 2_000),
    line_number: row.line_number,
    column_number: row.column_number,
    account_fingerprint: row.account_id
      ? hashFingerprint("account", row.account_id)
      : "account_anonymous",
    resolution: resolutionFromRow(resolution),
    comment: includeDetails
      ? redactCrashText(row.comment, MAX_DETAIL_CHARS)
      : "",
    stacktrace: includeDetails
      ? redactCrashText(row.stacktrace, MAX_DETAIL_CHARS)
      : "",
    user_agent: includeDetails
      ? redactCrashText(row.user_agent, MAX_DETAIL_CHARS)
      : "",
    uptime: includeDetails ? redactCrashText(row.uptime, 500) : "",
    start_time: includeDetails ? iso(row.start_time) : null,
  };
}

function normalizeStatus(
  value: AdminCrashStatus | undefined,
): AdminCrashStatus {
  return value === "solved" || value === "all" ? value : "open";
}

async function loadResolutionRows(
  reports: Array<{ signature: string; build_key: string }>,
) {
  if (reports.length === 0) return new Map<string, ResolutionRow>();
  const signatures = [...new Set(reports.map(({ signature }) => signature))];
  const buildKeys = [...new Set(reports.map(({ build_key }) => build_key))];
  const { rows } = await getPool().query<ResolutionRow>(
    `SELECT signature, build_key, status, report_id, resolved_by, note, resolved_at
       FROM webapp_error_resolutions
      WHERE signature = ANY($1::text[]) AND build_key = ANY($2::text[])`,
    [signatures, buildKeys],
  );
  return new Map(
    rows.map((row) => [`${row.signature}\0${row.build_key}`, row] as const),
  );
}

export async function readWebappCrashesLocal(
  opts: AdminCrashLocalReadRequest = {},
): Promise<AdminCrashLocalReadResponse> {
  const bayId = getConfiguredBayId();
  const limit = positiveInt(opts.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const sinceMinutes = positiveInt(
    opts.since_minutes,
    DEFAULT_SINCE_MINUTES,
    MAX_SINCE_MINUTES,
  );
  const reportId = `${opts.report_id ?? ""}`.trim();
  if (reportId && !isValidUUID(reportId))
    throw new Error("invalid crash report id");
  const sourceLimit = reportId
    ? 1
    : Math.min(
        MAX_LIMIT * SOURCE_LIMIT_MULTIPLIER,
        limit * SOURCE_LIMIT_MULTIPLIER,
      );
  const select = `SELECT id, account_id, name, message, comment, stacktrace, file,
            "lineNumber" AS line_number, "columnNumber" AS column_number,
            severity, browser, mobile, responsive, user_agent, path,
            smc_version, build_date, smc_git_rev, uptime, start_time, time
       FROM webapp_errors`;
  const { rows } = reportId
    ? await getPool().query<CrashRow>(`${select} WHERE id = $1::uuid LIMIT 1`, [
        reportId,
      ])
    : await getPool().query<CrashRow>(
        `${select}
          WHERE time >= NOW() - make_interval(secs => $1::double precision)
          ORDER BY time DESC
          LIMIT $2`,
        [sinceMinutes * 60, sourceLimit],
      );
  const unsigned = rows.map((row) => {
    const { signature } = crashSignature(row);
    return { signature, build_key: crashBuildKey(row) };
  });
  const resolutions = await loadResolutionRows(unsigned);
  const status = normalizeStatus(opts.status);
  const reports = rows
    .map((row, index) => {
      const key = `${unsigned[index].signature}\0${unsigned[index].build_key}`;
      return reportFromRow({
        row,
        bayId,
        resolution: resolutions.get(key),
        includeDetails: !!opts.include_details,
      });
    })
    .filter((report) => {
      if (status === "all") return true;
      return status === "solved" ? !!report.resolution : !report.resolution;
    })
    .slice(0, limit);
  return {
    bay_id: bayId,
    reports,
    source_candidates: rows.length,
    truncated: !reportId && rows.length >= sourceLimit,
  };
}

export async function setWebappCrashResolutionLocal({
  report_id,
  solved,
  actor_account_id,
  note,
  signature: requestedSignature,
  build_key: requestedBuildKey,
}: AdminCrashLocalResolutionRequest): Promise<AdminCrashLocalResolutionResponse> {
  if (!isValidUUID(report_id)) throw new Error("invalid crash report id");
  if (!isValidUUID(actor_account_id))
    throw new Error("invalid admin account id");
  const normalizedNote = truncate(`${note ?? ""}`.trim(), MAX_NOTE_CHARS);
  let signature = `${requestedSignature ?? ""}`.trim();
  let buildKey = `${requestedBuildKey ?? ""}`.trim();
  if (!signature || !buildKey) {
    const found = await readWebappCrashesLocal({
      report_id,
      status: "all",
      include_details: false,
      limit: 1,
    });
    const report = found.reports[0];
    if (!report) throw new Error(`crash report ${report_id} not found`);
    signature = report.signature;
    buildKey = report.build_key;
  }
  if (!/^crash_[0-9a-f]{16}$/.test(signature)) {
    throw new Error("invalid crash signature");
  }
  if (!buildKey || buildKey.length > 1_000) {
    throw new Error("invalid crash build key");
  }
  const { rows } = await getPool().query<ResolutionRow>(
    `INSERT INTO webapp_error_resolutions
       (signature, build_key, status, report_id, resolved_by, note, resolved_at, updated_at)
     VALUES ($1, $2, $3::varchar(16), $4::uuid, $5::uuid, $6,
             CASE WHEN $3::text = 'solved' THEN NOW() ELSE NULL END, NOW())
     ON CONFLICT (signature, build_key) DO UPDATE SET
       status = EXCLUDED.status,
       report_id = EXCLUDED.report_id,
       resolved_by = EXCLUDED.resolved_by,
       note = EXCLUDED.note,
       resolved_at = EXCLUDED.resolved_at,
       updated_at = NOW()
     RETURNING signature, build_key, status, report_id, resolved_by, note, resolved_at`,
    [
      signature,
      buildKey,
      solved ? "solved" : "open",
      report_id,
      actor_account_id,
      normalizedNote,
    ],
  );
  return {
    report_id,
    signature,
    build_key: buildKey,
    resolution: resolutionFromRow(rows[0]),
  };
}
