/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import type {
  AdminCrashBayError,
  AdminCrashListRequest,
  AdminCrashListResponse,
  AdminCrashReport,
  AdminCrashReportSummary,
  AdminCrashResolutionRequest,
  AdminCrashResolutionResponse,
  AdminCrashShowRequest,
  AdminCrashShowResponse,
  AdminCrashStatus,
  AdminCrashTriageGroup,
  AdminCrashTriageRequest,
  AdminCrashTriageResponse,
} from "@cocalc/conat/hub/api/admin-crashes";
import centralLog from "@cocalc/database/postgres/central-log";
import isAdmin from "@cocalc/server/accounts/is-admin";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { listConfiguredBays } from "@cocalc/server/bay-directory";
import { getInterBayBridge } from "@cocalc/server/inter-bay/bridge";
import {
  readWebappCrashesLocal,
  setWebappCrashResolutionLocal,
} from "@cocalc/server/webapp-crashes";
import { isValidUUID, uuid } from "@cocalc/util/misc";
import { requireDangerousSessionAuth } from "./dangerous-session-auth";

const logger = getLogger("server:conat:api:admin-crashes");
const DEFAULT_SINCE_MINUTES = 24 * 60;
const MAX_SINCE_MINUTES = 30 * 24 * 60;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 2_000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const MAX_MAX_BYTES = 4 * 1024 * 1024;
const MIN_MAX_BYTES = 16 * 1024;
const MAX_REASON_LENGTH = 500;
const INTER_BAY_TIMEOUT_MS = 20_000;
const BAY_CONCURRENCY = 4;

type AuthOpts = {
  account_id?: string;
  browser_id?: string | null;
  session_hash?: string | null;
};

function positiveInt(value: unknown, fallback: number, max: number): number {
  const n = Math.floor(Number(value ?? fallback));
  return Number.isFinite(n) && n > 0 ? Math.min(n, max) : fallback;
}

function requiredReason(value: unknown): string {
  const reason = `${value ?? ""}`.trim();
  if (!reason) throw new Error("a human-readable audit reason is required");
  if (reason.length > MAX_REASON_LENGTH) {
    throw new Error(`audit reason must be at most ${MAX_REASON_LENGTH} chars`);
  }
  return reason;
}

function normalizeStatus(
  value: AdminCrashStatus | undefined,
): AdminCrashStatus {
  if (value === "solved" || value === "all") return value;
  return "open";
}

async function requireAdmin(opts: AuthOpts): Promise<string> {
  const accountId = `${opts.account_id ?? ""}`.trim();
  if (!accountId) throw new Error("must be signed in");
  if (!(await isAdmin(accountId))) {
    throw Object.assign(new Error("admin privileges required"), { code: 403 });
  }
  return accountId;
}

async function requireFreshAdmin(opts: AuthOpts): Promise<string> {
  const accountId = await requireAdmin(opts);
  await requireDangerousSessionAuth({
    account_id: accountId,
    browser_id: opts.browser_id,
    session_hash: opts.session_hash,
    require_second_factor: "if_enabled",
  });
  return accountId;
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function errorText(error: unknown): string {
  return `${error instanceof Error ? error.message : error}`.slice(0, 2_000);
}

async function selectedBayIds(requested?: string): Promise<string[]> {
  const bayId = `${requested ?? ""}`.trim();
  const configured = [
    ...new Set((await listConfiguredBays()).map(({ bay_id }) => bay_id)),
  ];
  if (!bayId) return configured.sort();
  if (!configured.includes(bayId)) {
    throw new Error(`unknown or unavailable bay '${bayId}'`);
  }
  return [bayId];
}

async function mapWithConcurrency<T, U>(
  values: T[],
  fn: (value: T) => Promise<U>,
): Promise<U[]> {
  const output = new Array<U>(values.length);
  let next = 0;
  await Promise.all(
    Array.from(
      { length: Math.min(BAY_CONCURRENCY, values.length) },
      async () => {
        while (true) {
          const index = next++;
          if (index >= values.length) return;
          output[index] = await fn(values[index]);
        }
      },
    ),
  );
  return output;
}

async function readBay({
  bayId,
  sinceMinutes,
  limit,
  status,
  reportId,
  includeDetails,
}: {
  bayId: string;
  sinceMinutes: number;
  limit: number;
  status: AdminCrashStatus;
  reportId?: string;
  includeDetails?: boolean;
}) {
  const opts = {
    since_minutes: sinceMinutes,
    limit,
    status,
    report_id: reportId,
    include_details: includeDetails,
  };
  return bayId === getConfiguredBayId()
    ? await readWebappCrashesLocal(opts)
    : await getInterBayBridge()
        .bayOps(bayId, { timeout_ms: INTER_BAY_TIMEOUT_MS })
        .getWebappCrashes(opts);
}

async function readFleet({
  bayId,
  sinceMinutes,
  limit,
  status,
  reportId,
  includeDetails,
}: {
  bayId?: string;
  sinceMinutes: number;
  limit: number;
  status: AdminCrashStatus;
  reportId?: string;
  includeDetails?: boolean;
}): Promise<{
  bayIds: string[];
  reports: AdminCrashReport[];
  errors: AdminCrashBayError[];
  sourceCandidates: number;
  truncated: boolean;
}> {
  const bayIds = await selectedBayIds(bayId);
  const results = await mapWithConcurrency(bayIds, async (target) => {
    try {
      return {
        ok: true as const,
        result: await readBay({
          bayId: target,
          sinceMinutes,
          limit,
          status,
          reportId,
          includeDetails,
        }),
      };
    } catch (error) {
      return { ok: false as const, bay_id: target, error: errorText(error) };
    }
  });
  const reports: AdminCrashReport[] = [];
  const errors: AdminCrashBayError[] = [];
  let sourceCandidates = 0;
  let truncated = false;
  for (const item of results) {
    if (!item.ok) {
      errors.push({ bay_id: item.bay_id, error: item.error });
      continue;
    }
    reports.push(...item.result.reports);
    sourceCandidates += item.result.source_candidates;
    truncated ||= item.result.truncated;
  }
  reports.sort((a, b) => b.time.localeCompare(a.time));
  if (reports.length > limit) {
    reports.length = limit;
    truncated = true;
  }
  return { bayIds, reports, errors, sourceCandidates, truncated };
}

async function recordAudit({
  auditId,
  accountId,
  mode,
  reason,
  bayId,
  reportId,
  resultCount,
  resultBytes,
  durationMs,
  error,
}: {
  auditId: string;
  accountId: string;
  mode: "list" | "show" | "triage" | "resolve" | "reopen";
  reason: string;
  bayId?: string;
  reportId?: string;
  resultCount?: number;
  resultBytes?: number;
  durationMs: number;
  error?: unknown;
}) {
  try {
    await centralLog({
      event: "admin_crash_operator",
      value: {
        audit_id: auditId,
        account_id: accountId,
        mode,
        reason,
        bay_id: bayId ?? null,
        report_id: reportId ?? null,
        result_count: resultCount ?? null,
        result_bytes: resultBytes ?? null,
        duration_ms: durationMs,
        error: error == null ? null : errorText(error),
      },
    });
  } catch (error) {
    logger.warn("failed to write crash operator audit event", {
      auditId,
      error,
    });
  }
}

function trimReportsToBytes<
  T extends {
    reports: AdminCrashReportSummary[];
    result_bytes: number;
    truncated: boolean;
  },
>(response: T, maxBytes: number): T {
  response.result_bytes = serializedBytes(response);
  while (response.result_bytes > maxBytes && response.reports.length > 0) {
    response.reports.pop();
    response.truncated = true;
    response.result_bytes = serializedBytes(response);
  }
  return response;
}

async function listInternal(
  opts: AdminCrashListRequest,
): Promise<Omit<AdminCrashListResponse, "audit_id">> {
  const sinceMinutes = positiveInt(
    opts.since_minutes,
    DEFAULT_SINCE_MINUTES,
    MAX_SINCE_MINUTES,
  );
  const limit = positiveInt(opts.limit, DEFAULT_LIMIT, MAX_LIMIT);
  const maxBytes = Math.max(
    MIN_MAX_BYTES,
    positiveInt(opts.max_bytes, DEFAULT_MAX_BYTES, MAX_MAX_BYTES),
  );
  const status = normalizeStatus(opts.status);
  const fleet = await readFleet({
    bayId: opts.bay_id,
    sinceMinutes,
    limit,
    status,
  });
  const response: Omit<AdminCrashListResponse, "audit_id"> = {
    server_time: new Date().toISOString(),
    since: new Date(Date.now() - sinceMinutes * 60_000).toISOString(),
    status,
    reports: fleet.reports,
    queried_bays: fleet.bayIds,
    bay_errors: fleet.errors,
    source_candidates: fleet.sourceCandidates,
    result_bytes: 0,
    truncated: fleet.truncated,
    redaction: "best_effort",
  };
  return trimReportsToBytes(response, maxBytes);
}

export function buildCrashTriageGroups(
  reports: AdminCrashReportSummary[],
): AdminCrashTriageGroup[] {
  const groups = new Map<string, AdminCrashTriageGroup>();
  const accountSets = new Map<string, Set<string>>();
  for (const report of reports) {
    const key = `${report.signature}:${report.build_key}`;
    const group = groups.get(key) ?? {
      key,
      signature: report.signature,
      signature_label: report.signature_label,
      build_key: report.build_key,
      status: report.resolution ? "solved" : "open",
      count: 0,
      distinct_accounts: 0,
      first_seen: report.time,
      last_seen: report.time,
      report_ids: [],
      bay_ids: [],
      browsers: [],
      paths: [],
      resolution: report.resolution,
    };
    group.count += 1;
    group.first_seen = [group.first_seen, report.time].sort()[0];
    group.last_seen = [group.last_seen, report.time].sort().at(-1)!;
    group.report_ids = [...new Set([...group.report_ids, report.id])].slice(
      0,
      20,
    );
    group.bay_ids = [...new Set([...group.bay_ids, report.bay_id])].sort();
    group.browsers = [...new Set([...group.browsers, report.browser])]
      .filter(Boolean)
      .slice(0, 10);
    group.paths = [...new Set([...group.paths, report.path])]
      .filter(Boolean)
      .slice(0, 10);
    if (!report.resolution) {
      group.status = "open";
      group.resolution = null;
    }
    const accounts = accountSets.get(key) ?? new Set<string>();
    accounts.add(report.account_fingerprint);
    accountSets.set(key, accounts);
    group.distinct_accounts = accounts.size;
    groups.set(key, group);
  }
  return [...groups.values()].sort(
    (a, b) => b.count - a.count || b.last_seen.localeCompare(a.last_seen),
  );
}

export async function list(
  opts: AdminCrashListRequest & AuthOpts,
): Promise<AdminCrashListResponse> {
  const started = Date.now();
  const auditId = uuid();
  const accountId = await requireAdmin(opts);
  const reason = requiredReason(opts.reason);
  try {
    const result = { audit_id: auditId, ...(await listInternal(opts)) };
    await recordAudit({
      auditId,
      accountId,
      mode: "list",
      reason,
      bayId: opts.bay_id,
      resultCount: result.reports.length,
      resultBytes: result.result_bytes,
      durationMs: Date.now() - started,
    });
    return result;
  } catch (error) {
    await recordAudit({
      auditId,
      accountId,
      mode: "list",
      reason,
      bayId: opts.bay_id,
      durationMs: Date.now() - started,
      error,
    });
    throw error;
  }
}

export async function show(
  opts: AdminCrashShowRequest & AuthOpts,
): Promise<AdminCrashShowResponse> {
  const started = Date.now();
  const auditId = uuid();
  const accountId = await requireAdmin(opts);
  const reason = requiredReason(opts.reason);
  if (!isValidUUID(opts.report_id)) throw new Error("invalid crash report id");
  const maxBytes = Math.max(
    MIN_MAX_BYTES,
    positiveInt(opts.max_bytes, DEFAULT_MAX_BYTES, MAX_MAX_BYTES),
  );
  try {
    const fleet = await readFleet({
      bayId: opts.bay_id,
      sinceMinutes: MAX_SINCE_MINUTES,
      limit: 1,
      status: "all",
      reportId: opts.report_id,
      includeDetails: true,
    });
    const report = fleet.reports[0];
    if (!report) throw new Error(`crash report ${opts.report_id} not found`);
    const result: AdminCrashShowResponse = {
      audit_id: auditId,
      server_time: new Date().toISOString(),
      report,
      queried_bays: fleet.bayIds,
      bay_errors: fleet.errors,
      result_bytes: 0,
      truncated: false,
      redaction: "best_effort",
    };
    result.result_bytes = serializedBytes(result);
    if (result.result_bytes > maxBytes) {
      report.stacktrace = report.stacktrace.slice(0, Math.max(0, maxBytes / 2));
      report.comment = report.comment.slice(0, Math.max(0, maxBytes / 8));
      report.user_agent = report.user_agent.slice(0, 2_000);
      result.truncated = true;
      result.result_bytes = serializedBytes(result);
    }
    await recordAudit({
      auditId,
      accountId,
      mode: "show",
      reason,
      bayId: report.bay_id,
      reportId: opts.report_id,
      resultCount: 1,
      resultBytes: result.result_bytes,
      durationMs: Date.now() - started,
    });
    return result;
  } catch (error) {
    await recordAudit({
      auditId,
      accountId,
      mode: "show",
      reason,
      bayId: opts.bay_id,
      reportId: opts.report_id,
      durationMs: Date.now() - started,
      error,
    });
    throw error;
  }
}

export async function triage(
  opts: AdminCrashTriageRequest & AuthOpts,
): Promise<AdminCrashTriageResponse> {
  const started = Date.now();
  const auditId = uuid();
  const accountId = await requireAdmin(opts);
  const reason = requiredReason(opts.reason);
  try {
    const listed = await listInternal(opts);
    const maxBytes = Math.max(
      MIN_MAX_BYTES,
      positiveInt(opts.max_bytes, DEFAULT_MAX_BYTES, MAX_MAX_BYTES),
    );
    let groups = buildCrashTriageGroups(listed.reports);
    const result: AdminCrashTriageResponse = {
      audit_id: auditId,
      ...listed,
      groups,
      open_groups: groups.filter(({ status }) => status === "open").length,
      solved_groups: groups.filter(({ status }) => status === "solved").length,
    };
    result.result_bytes = serializedBytes(result);
    while (result.result_bytes > maxBytes && result.reports.length > 0) {
      result.reports.length = Math.floor(result.reports.length * 0.8);
      result.truncated = true;
      groups = buildCrashTriageGroups(result.reports);
      result.groups = groups;
      result.open_groups = groups.filter(
        ({ status }) => status === "open",
      ).length;
      result.solved_groups = groups.filter(
        ({ status }) => status === "solved",
      ).length;
      result.result_bytes = serializedBytes(result);
    }
    await recordAudit({
      auditId,
      accountId,
      mode: "triage",
      reason,
      bayId: opts.bay_id,
      resultCount: groups.length,
      resultBytes: result.result_bytes,
      durationMs: Date.now() - started,
    });
    return result;
  } catch (error) {
    await recordAudit({
      auditId,
      accountId,
      mode: "triage",
      reason,
      bayId: opts.bay_id,
      durationMs: Date.now() - started,
      error,
    });
    throw error;
  }
}

async function changeResolution(
  opts: Omit<AdminCrashResolutionRequest, "solved"> & AuthOpts,
  solved: boolean,
): Promise<AdminCrashResolutionResponse> {
  const started = Date.now();
  const auditId = uuid();
  const accountId = await requireFreshAdmin(opts);
  const reason = requiredReason(opts.reason);
  if (!isValidUUID(opts.report_id)) throw new Error("invalid crash report id");
  const bayId = `${opts.bay_id ?? ""}`.trim();
  if (!bayId)
    throw new Error("bay_id is required for crash resolution changes");
  const mode = solved ? "resolve" : "reopen";
  try {
    await selectedBayIds(bayId);
    const source = await readBay({
      bayId,
      sinceMinutes: MAX_SINCE_MINUTES,
      limit: 1,
      status: "all",
      reportId: opts.report_id,
      includeDetails: false,
    });
    const report = source.reports[0];
    if (!report) throw new Error(`crash report ${opts.report_id} not found`);
    const request = {
      report_id: opts.report_id,
      solved,
      actor_account_id: accountId,
      note: opts.note,
      signature: report.signature,
      build_key: report.build_key,
    };
    const allBayIds = await selectedBayIds();
    const writes = await mapWithConcurrency(allBayIds, async (target) => {
      try {
        const result =
          target === getConfiguredBayId()
            ? await setWebappCrashResolutionLocal(request)
            : await getInterBayBridge()
                .bayOps(target, { timeout_ms: INTER_BAY_TIMEOUT_MS })
                .setWebappCrashResolution(request);
        return { ok: true as const, bay_id: target, result };
      } catch (error) {
        return {
          ok: false as const,
          bay_id: target,
          error: errorText(error),
        };
      }
    });
    const successful = writes.filter((item) => item.ok);
    const bayErrors = writes
      .filter((item) => !item.ok)
      .map((item) => ({ bay_id: item.bay_id, error: item.error }));
    if (successful.length === 0) {
      throw new Error("failed to update crash resolution on every bay");
    }
    const result: AdminCrashResolutionResponse = {
      audit_id: auditId,
      server_time: new Date().toISOString(),
      bay_id: bayId,
      report_id: report.id,
      signature: report.signature,
      build_key: report.build_key,
      resolution: successful[0].result.resolution,
      updated_bays: successful.map(({ bay_id }) => bay_id),
      bay_errors: bayErrors,
    };
    await recordAudit({
      auditId,
      accountId,
      mode,
      reason,
      bayId,
      reportId: opts.report_id,
      resultCount: 1,
      resultBytes: serializedBytes(result),
      durationMs: Date.now() - started,
    });
    return result;
  } catch (error) {
    await recordAudit({
      auditId,
      accountId,
      mode,
      reason,
      bayId,
      reportId: opts.report_id,
      durationMs: Date.now() - started,
      error,
    });
    throw error;
  }
}

export async function resolve(
  opts: Omit<AdminCrashResolutionRequest, "solved"> & AuthOpts,
) {
  return await changeResolution(opts, true);
}

export async function reopen(
  opts: Omit<AdminCrashResolutionRequest, "solved"> & AuthOpts,
) {
  return await changeResolution(opts, false);
}
