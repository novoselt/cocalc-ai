/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getDatabase } from "@cocalc/lite/hub/sqlite/database";
import type {
  HostSqliteQueryRequest,
  HostSqliteQueryResponse,
} from "@cocalc/conat/project-host/api";

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;
const DEFAULT_MAX_BYTES = 1 * 1024 * 1024;
const MAX_MAX_BYTES = 5 * 1024 * 1024;

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

function trimTrailingSemicolon(sql: string): string {
  return sql.trim().replace(/;\s*$/, "").trim();
}

function stripLeadingComments(sql: string): string {
  let remaining = sql.trim();
  while (true) {
    if (remaining.startsWith("--")) {
      const newline = remaining.indexOf("\n");
      if (newline < 0) return "";
      remaining = remaining.slice(newline + 1).trim();
      continue;
    }
    if (remaining.startsWith("/*")) {
      const end = remaining.indexOf("*/");
      if (end < 0) return "";
      remaining = remaining.slice(end + 2).trim();
      continue;
    }
    return remaining;
  }
}

function rejectUnsafeSql(sql: string): void {
  const normalized = stripLeadingComments(sql);
  if (!normalized) {
    throw new Error("SQL must be non-empty");
  }
  if (normalized.includes(";")) {
    throw new Error("project-host SQLite query supports exactly one statement");
  }
  if (!/^(select|with)\b/i.test(normalized)) {
    throw new Error(
      "project-host SQLite query is read-only and only supports SELECT or WITH",
    );
  }
  if (
    /\b(insert|update|delete|replace|drop|alter|create|attach|detach|vacuum|reindex|analyze|begin|commit|rollback)\b/i.test(
      normalized,
    )
  ) {
    throw new Error("project-host SQLite query contains a disallowed keyword");
  }
}

function truncateRows({
  rows,
  maxBytes,
}: {
  rows: unknown[][];
  maxBytes: number;
}): { rows: unknown[][]; bytes: number; truncated: boolean } {
  let output = rows;
  let encoded = JSON.stringify(output);
  let truncated = false;
  while (Buffer.byteLength(encoded, "utf8") > maxBytes && output.length > 0) {
    truncated = true;
    output = output.slice(0, -1);
    encoded = JSON.stringify(output);
  }
  return {
    rows: output,
    bytes: Buffer.byteLength(encoded, "utf8"),
    truncated,
  };
}

function fieldsFromStatement(statement: any, rows: Record<string, unknown>[]) {
  const columns = statement.columns?.();
  if (Array.isArray(columns) && columns.length > 0) {
    return columns.map((column) => ({ name: `${column.name ?? ""}` }));
  }
  return Object.keys(rows[0] ?? {}).map((name) => ({ name }));
}

export function querySqlite({
  sql,
  limit,
  max_bytes,
}: HostSqliteQueryRequest): HostSqliteQueryResponse {
  const normalizedSql = trimTrailingSemicolon(`${sql ?? ""}`);
  rejectUnsafeSql(normalizedSql);
  const normalizedLimit = normalizePositiveInt({
    value: limit,
    fallback: DEFAULT_LIMIT,
    max: MAX_LIMIT,
  });
  const maxBytes = normalizePositiveInt({
    value: max_bytes,
    fallback: DEFAULT_MAX_BYTES,
    max: MAX_MAX_BYTES,
  });
  const started = Date.now();
  const executedSql = `SELECT * FROM (${normalizedSql}) AS project_host_admin_sqlite_query LIMIT ${
    normalizedLimit + 1
  }`;
  const statement = getDatabase().prepare(executedSql);
  const resultRows = statement.all() as Record<string, unknown>[];
  const overLimit = resultRows.length > normalizedLimit;
  const limited = overLimit ? resultRows.slice(0, normalizedLimit) : resultRows;
  const fields = fieldsFromStatement(statement, limited);
  const rows = limited.map((row) => fields.map((field) => row[field.name]));
  const truncated = truncateRows({ rows, maxBytes });
  return {
    duration_ms: Date.now() - started,
    fields,
    rows: truncated.rows,
    row_count: truncated.rows.length,
    result_bytes: truncated.bytes,
    truncated: overLimit || truncated.truncated,
    executed_sql: executedSql,
  };
}
