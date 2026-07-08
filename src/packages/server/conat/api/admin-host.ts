/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { createHash } from "crypto";
import centralLog from "@cocalc/database/postgres/central-log";
import getLogger from "@cocalc/backend/logger";
import isAdmin from "@cocalc/server/accounts/is-admin";
import { getRoutedHostControlClient } from "@cocalc/server/project-host/client";
import { isValidUUID, uuid } from "@cocalc/util/misc";
import type {
  AdminHostLogsRequest,
  AdminHostLogsResponse,
} from "@cocalc/conat/hub/api/admin-host";

type AdminAuthOpts = {
  account_id?: string;
};

const logger = getLogger("server:conat:api:admin-host");

const DEFAULT_LOG_LINES = 200;
const MAX_LOG_LINES = 5000;
const DEFAULT_MAX_BYTES = 512 * 1024;
const MAX_MAX_BYTES = 2 * 1024 * 1024;

function normalizePositiveInt({
  value,
  fallback,
  max,
}: {
  value?: number;
  fallback: number;
  max: number;
}): number {
  const n = Math.floor(Number(value ?? fallback));
  if (!Number.isFinite(n) || n <= 0) {
    return fallback;
  }
  return Math.min(n, max);
}

async function requireAdminAccount({
  account_id,
}: AdminAuthOpts): Promise<string> {
  const accountId = `${account_id ?? ""}`.trim();
  if (!accountId) {
    throw new Error("must be signed in");
  }
  if (!(await isAdmin(accountId))) {
    throw Object.assign(new Error("admin privileges required"), { code: 403 });
  }
  return accountId;
}

function textHash(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function filterLogText(text: string, grep?: string): string {
  const needle = `${grep ?? ""}`.trim();
  if (!needle) {
    return text;
  }
  if (needle.length > 200) {
    throw new Error("--grep must be at most 200 characters");
  }
  return text
    .split(/\r?\n/)
    .filter((line) => line.includes(needle))
    .join("\n");
}

function truncateText({ text, maxBytes }: { text: string; maxBytes: number }): {
  text: string;
  bytes: number;
  truncated: boolean;
} {
  const bytes = Buffer.byteLength(text, "utf8");
  if (bytes <= maxBytes) {
    return { text, bytes, truncated: false };
  }
  const buffer = Buffer.from(text, "utf8");
  const truncated = buffer.subarray(buffer.length - maxBytes).toString("utf8");
  return {
    text: `[truncated to last ${maxBytes} bytes]\n${truncated}`,
    bytes: maxBytes,
    truncated: true,
  };
}

async function recordAudit({
  audit_id,
  account_id,
  host_id,
  source,
  lines,
  grep,
  reason,
  duration_ms,
  result_bytes,
  truncated,
  error,
}: {
  audit_id: string;
  account_id: string;
  host_id: string;
  source?: string;
  lines?: number;
  grep?: string;
  reason?: string;
  duration_ms?: number;
  result_bytes?: number;
  truncated?: boolean;
  error?: unknown;
}) {
  try {
    await centralLog({
      event: "admin_host_operator",
      value: {
        audit_id,
        account_id,
        mode: "logs",
        host_id,
        source: source ?? null,
        lines: lines ?? null,
        grep_sha256: grep ? textHash(grep) : null,
        reason: reason ?? null,
        duration_ms,
        result_bytes,
        truncated,
        error: error == null ? null : `${error}`,
      },
    });
  } catch (err) {
    logger.warn("failed to write admin host audit event", { audit_id, err });
  }
}

export async function logs({
  account_id,
  host_id,
  source,
  lines,
  grep,
  max_bytes,
  reason,
}: AdminAuthOpts & AdminHostLogsRequest): Promise<AdminHostLogsResponse> {
  const accountId = await requireAdminAccount({ account_id });
  const hostId = `${host_id ?? ""}`.trim();
  if (!isValidUUID(hostId)) {
    throw new Error("--host-id must be a valid project-host id");
  }
  const normalizedLines = normalizePositiveInt({
    value: lines,
    fallback: DEFAULT_LOG_LINES,
    max: MAX_LOG_LINES,
  });
  const maxBytes = normalizePositiveInt({
    value: max_bytes,
    fallback: DEFAULT_MAX_BYTES,
    max: MAX_MAX_BYTES,
  });
  const audit_id = uuid();
  await recordAudit({
    audit_id,
    account_id: accountId,
    host_id: hostId,
    source,
    lines: normalizedLines,
    grep,
    reason,
  });
  const started = Date.now();
  try {
    const client = await getRoutedHostControlClient({
      host_id: hostId,
      timeout: 30_000,
      fresh: true,
    });
    const response = await client.getRuntimeLog({
      lines: normalizedLines,
      source,
    });
    const filtered = filterLogText(response.text, grep);
    const truncated = truncateText({ text: filtered, maxBytes });
    await recordAudit({
      audit_id,
      account_id: accountId,
      host_id: hostId,
      source: response.source,
      lines: response.lines,
      grep,
      reason,
      duration_ms: Date.now() - started,
      result_bytes: truncated.bytes,
      truncated: truncated.truncated,
    });
    return {
      audit_id,
      host_id: hostId,
      source: response.source,
      requested_source: source,
      server_time: new Date().toISOString(),
      lines: response.lines,
      text: truncated.text,
      result_bytes: truncated.bytes,
      truncated: truncated.truncated,
    };
  } catch (err) {
    await recordAudit({
      audit_id,
      account_id: accountId,
      host_id: hostId,
      source,
      lines: normalizedLines,
      grep,
      reason,
      duration_ms: Date.now() - started,
      error: err,
    });
    throw err;
  }
}
