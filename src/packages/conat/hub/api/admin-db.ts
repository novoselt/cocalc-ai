/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { authFirstRequireAccount } from "./util";

export type AdminDbDiagnostic =
  | "activity"
  | "locks"
  | "table-sizes"
  | "lro"
  | "backup-health"
  | "host-health"
  | "project"
  | "migration-health";

export interface AdminDbField {
  name: string;
  data_type_id?: number;
}

export interface AdminDbExecuteRequest {
  bay_id?: string;
  sql?: string;
  diagnostic?: AdminDbDiagnostic;
  params?: Record<string, unknown>;
  reason?: string;
  limit?: number;
  max_bytes?: number;
  statement_timeout_ms?: number;
  lock_timeout_ms?: number;
}

export interface AdminDbExecuteResponse {
  audit_id: string;
  bay_id: string;
  server_time: string;
  mode: "query" | "diagnostic";
  diagnostic?: AdminDbDiagnostic;
  duration_ms: number;
  fields: AdminDbField[];
  rows: unknown[][];
  row_count: number;
  truncated: boolean;
  result_bytes: number;
  executed_sql?: string;
}

export const adminDb = {
  query: authFirstRequireAccount,
  diagnostic: authFirstRequireAccount,
};

export interface AdminDbApi {
  query: (opts: AdminDbExecuteRequest) => Promise<AdminDbExecuteResponse>;
  diagnostic: (opts: AdminDbExecuteRequest) => Promise<AdminDbExecuteResponse>;
}
