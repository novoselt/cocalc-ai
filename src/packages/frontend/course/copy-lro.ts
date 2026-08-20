/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { LroSummary } from "@cocalc/conat/hub/api/lro";
import type { ProjectCopyRow } from "@cocalc/conat/hub/api/projects";
import { isLroTerminalStatus } from "@cocalc/conat/lro/status";
import { webapp_client } from "../webapp-client";

export interface CourseCopyLro {
  op_id: string;
  scope_type: "project";
  scope_id: string;
}

export interface CourseCopyDestination {
  student_id: string;
  project_id: string;
}

export type CourseCopyResultByStudent = Record<string, string>;

type CourseCollectItemResult = {
  student_id: string;
  status: string;
  error?: string;
};

const TERMINAL_COPY_STATUSES = new Set([
  "done",
  "failed",
  "canceled",
  "expired",
]);

function aggregateError(summary: LroSummary): string {
  return summary.error ?? `copy ${summary.status}`;
}

function rowError(row: ProjectCopyRow): string {
  if (row.status === "done") {
    return "";
  }
  return row.last_error ?? `copy ${row.status}`;
}

function allRowsTerminal(rows: ProjectCopyRow[]): boolean {
  return rows.every((row) => TERMINAL_COPY_STATUSES.has(row.status));
}

function isTransientReadError(err: unknown): boolean {
  const code = Number((err as any)?.code);
  if (code === 408 || code === 429 || code === 503) {
    return true;
  }
  return /timeout|timed out|connection|disconnected|temporarily unavailable/i.test(
    `${(err as any)?.message ?? err ?? ""}`,
  );
}

async function retryDurableRead<T>(read: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await read();
    } catch (err) {
      lastError = err;
      if (!isTransientReadError(err) || attempt === 4) {
        throw err;
      }
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(4_000, 250 * 2 ** attempt)),
      );
    }
  }
  throw lastError;
}

function summarizeRows({
  summary,
  rows,
  dests,
}: {
  summary: LroSummary;
  rows: ProjectCopyRow[];
  dests: CourseCopyDestination[];
}): CourseCopyResultByStudent {
  const result: CourseCopyResultByStudent = {};
  const rowsByProject = new Map<string, ProjectCopyRow[]>();
  for (const row of rows) {
    const existing = rowsByProject.get(row.dest_project_id) ?? [];
    existing.push(row);
    rowsByProject.set(row.dest_project_id, existing);
  }

  for (const dest of dests) {
    const projectRows = rowsByProject.get(dest.project_id) ?? [];
    if (projectRows.length === 0) {
      result[dest.student_id] =
        summary.status === "succeeded" ? "" : aggregateError(summary);
      continue;
    }
    const failed = projectRows.find((row) => row.status !== "done");
    result[dest.student_id] = failed ? rowError(failed) : "";
  }
  return result;
}

export async function waitForCourseCopyLro({
  op,
  dests,
  onSummary,
}: {
  op: CourseCopyLro;
  dests: CourseCopyDestination[];
  onSummary?: (summary: LroSummary) => void;
}): Promise<CourseCopyResultByStudent> {
  try {
    await webapp_client.conat_client.lroWait({
      op_id: op.op_id,
      scope_type: op.scope_type,
      scope_id: op.scope_id,
      timeout_ms: 2 * 60 * 60 * 1000,
      onSummary,
    });
  } catch (err) {
    const reconciled = await reconcileCourseCopyLro({ op, dests });
    if (reconciled != null) {
      return reconciled;
    }
    throw err;
  }
  const reconciled = await reconcileCourseCopyLro({ op, dests });
  if (reconciled == null) {
    throw new Error("copy operation did not reach a terminal state");
  }
  return reconciled;
}

export async function reconcileCourseCopyLro({
  op,
  dests,
}: {
  op: CourseCopyLro;
  dests: CourseCopyDestination[];
}): Promise<CourseCopyResultByStudent | undefined> {
  const summary = await retryDurableRead(
    async () =>
      await webapp_client.conat_client.hub.lro.get({
        op_id: op.op_id,
        timeout: 60_000,
      }),
  );
  if (!summary || !isLroTerminalStatus(summary.status)) {
    return;
  }
  const rows = await retryDurableRead(
    async () =>
      await webapp_client.project_client.listCopyRowsByOpId({
        op_id: op.op_id,
      }),
  );
  if (rows.length > 0 && !allRowsTerminal(rows)) {
    return;
  }
  return summarizeRows({ summary, rows, dests });
}

export function courseCopyDestinationsFromSummary(
  summary: LroSummary,
): CourseCopyDestination[] {
  if (!Array.isArray(summary.input?.dests)) {
    return [];
  }
  return summary.input.dests
    .map((dest: any) => ({
      student_id: `${dest?.metadata?.student_id ?? ""}`,
      project_id: `${dest?.project_id ?? ""}`,
    }))
    .filter((dest) => dest.student_id && dest.project_id);
}

export function courseCollectResultByStudent(
  summary: LroSummary,
): CourseCopyResultByStudent {
  const result: CourseCopyResultByStudent = {};
  const items = summary.result?.items;
  if (!Array.isArray(items)) {
    return result;
  }
  for (const item of items as CourseCollectItemResult[]) {
    if (!item?.student_id) continue;
    result[item.student_id] =
      item.status === "done" ? "" : (item.error ?? item.status);
  }
  return result;
}
