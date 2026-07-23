/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { authFirstRequireAccount } from "./util";

export const ADMIN_CRASH_STATUSES = ["open", "solved", "all"] as const;
export type AdminCrashStatus = (typeof ADMIN_CRASH_STATUSES)[number];

export interface AdminCrashResolution {
  status: "solved";
  report_id: string;
  resolved_at: string;
  resolved_by_fingerprint: string;
  note: string;
}

export interface AdminCrashReportSummary {
  id: string;
  bay_id: string;
  time: string;
  name: string;
  message: string;
  severity: string;
  signature: string;
  signature_label: string;
  build_key: string;
  smc_git_rev: string;
  smc_version: string;
  build_date: string;
  browser: string;
  mobile: boolean | null;
  responsive: boolean | null;
  path: string;
  file: string;
  line_number: number | null;
  column_number: number | null;
  account_fingerprint: string;
  resolution: AdminCrashResolution | null;
}

export interface AdminCrashReport extends AdminCrashReportSummary {
  comment: string;
  stacktrace: string;
  user_agent: string;
  uptime: string;
  start_time: string | null;
}

export interface AdminCrashBayError {
  bay_id: string;
  error: string;
}

export interface AdminCrashListRequest {
  since_minutes?: number;
  limit?: number;
  max_bytes?: number;
  bay_id?: string;
  status?: AdminCrashStatus;
  reason: string;
}

export interface AdminCrashListResponse {
  audit_id: string;
  server_time: string;
  since: string;
  status: AdminCrashStatus;
  reports: AdminCrashReportSummary[];
  queried_bays: string[];
  bay_errors: AdminCrashBayError[];
  source_candidates: number;
  result_bytes: number;
  truncated: boolean;
  redaction: "best_effort";
}

export interface AdminCrashShowRequest {
  report_id: string;
  bay_id?: string;
  max_bytes?: number;
  reason: string;
}

export interface AdminCrashShowResponse {
  audit_id: string;
  server_time: string;
  report: AdminCrashReport;
  queried_bays: string[];
  bay_errors: AdminCrashBayError[];
  result_bytes: number;
  truncated: boolean;
  redaction: "best_effort";
}

export interface AdminCrashTriageRequest extends AdminCrashListRequest {}

export interface AdminCrashTriageGroup {
  key: string;
  signature: string;
  signature_label: string;
  build_key: string;
  status: "open" | "solved";
  count: number;
  distinct_accounts: number;
  first_seen: string;
  last_seen: string;
  report_ids: string[];
  bay_ids: string[];
  browsers: string[];
  paths: string[];
  resolution: AdminCrashResolution | null;
}

export interface AdminCrashTriageResponse extends Omit<
  AdminCrashListResponse,
  "reports"
> {
  reports: AdminCrashReportSummary[];
  groups: AdminCrashTriageGroup[];
  open_groups: number;
  solved_groups: number;
}

export interface AdminCrashResolutionRequest {
  report_id: string;
  bay_id: string;
  solved: boolean;
  note?: string;
  reason: string;
}

export interface AdminCrashResolutionResponse {
  audit_id: string;
  server_time: string;
  bay_id: string;
  report_id: string;
  signature: string;
  build_key: string;
  resolution: AdminCrashResolution | null;
  updated_bays: string[];
  bay_errors: AdminCrashBayError[];
}

export interface AdminCrashLocalReadRequest {
  since_minutes?: number;
  limit?: number;
  report_id?: string;
  status?: AdminCrashStatus;
  include_details?: boolean;
}

export interface AdminCrashLocalReadResponse {
  bay_id: string;
  reports: AdminCrashReport[];
  source_candidates: number;
  truncated: boolean;
}

export interface AdminCrashLocalResolutionRequest {
  report_id: string;
  solved: boolean;
  actor_account_id: string;
  note?: string;
  signature?: string;
  build_key?: string;
}

export interface AdminCrashLocalResolutionResponse {
  report_id: string;
  signature: string;
  build_key: string;
  resolution: AdminCrashResolution | null;
}

export const adminCrashes = {
  list: authFirstRequireAccount,
  show: authFirstRequireAccount,
  triage: authFirstRequireAccount,
  resolve: authFirstRequireAccount,
  reopen: authFirstRequireAccount,
};

export interface AdminCrashesApi {
  list: (opts: AdminCrashListRequest) => Promise<AdminCrashListResponse>;
  show: (opts: AdminCrashShowRequest) => Promise<AdminCrashShowResponse>;
  triage: (opts: AdminCrashTriageRequest) => Promise<AdminCrashTriageResponse>;
  resolve: (
    opts: Omit<AdminCrashResolutionRequest, "solved">,
  ) => Promise<AdminCrashResolutionResponse>;
  reopen: (
    opts: Omit<AdminCrashResolutionRequest, "solved">,
  ) => Promise<AdminCrashResolutionResponse>;
}
