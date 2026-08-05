/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { authFirstRequireAccount } from "./util";

export const ADMIN_SUPPORT_TICKET_STATUSES = [
  "new",
  "open",
  "pending",
  "hold",
  "solved",
  "closed",
] as const;

export type AdminSupportTicketStatus =
  (typeof ADMIN_SUPPORT_TICKET_STATUSES)[number];

export const ADMIN_SUPPORT_MUTABLE_TICKET_STATUSES = [
  "new",
  "open",
  "pending",
  "hold",
  "solved",
] as const;

export type AdminSupportMutableTicketStatus =
  (typeof ADMIN_SUPPORT_MUTABLE_TICKET_STATUSES)[number];

export const ADMIN_SUPPORT_TICKET_PRIORITIES = [
  "low",
  "normal",
  "high",
  "urgent",
] as const;

export type AdminSupportTicketPriority =
  (typeof ADMIN_SUPPORT_TICKET_PRIORITIES)[number];

export const ADMIN_SUPPORT_CATEGORIES = [
  "availability",
  "performance",
  "project_start",
  "files",
  "terminal",
  "codex",
  "jupyter",
  "billing",
  "account_access",
  "abuse_security",
  "bug",
  "how_to",
  "other",
] as const;

export type AdminSupportCategory = (typeof ADMIN_SUPPORT_CATEGORIES)[number];

export interface AdminSupportTicketSignals {
  categories: AdminSupportCategory[];
  error_signatures: string[];
}

export interface AdminSupportTicketSummary {
  id: number;
  agent_url: string;
  status: AdminSupportTicketStatus | "unknown";
  type?: string;
  priority?: string;
  assignee_id?: number | null;
  tags: string[];
  subject: string;
  description_preview: string;
  created_at: string;
  updated_at: string;
  account_fingerprint?: string;
  project_ids: string[];
  signals: AdminSupportTicketSignals;
}

export interface AdminSupportTicketComment {
  id: number;
  author: "requester" | "staff_or_system";
  public: boolean;
  created_at: string;
  body: string;
  attachment_count: number;
  attachment_bytes: number;
}

export interface AdminSupportListRequest {
  since_minutes?: number;
  limit?: number;
  statuses?: AdminSupportTicketStatus[];
  max_bytes?: number;
  reason: string;
}

export interface AdminSupportListResponse {
  audit_id: string;
  server_time: string;
  since: string;
  statuses: AdminSupportTicketStatus[];
  tickets: AdminSupportTicketSummary[];
  source_candidates: number;
  result_bytes: number;
  truncated: boolean;
  redaction: "best_effort";
}

export interface AdminSupportShowRequest {
  ticket_id: number;
  max_comments?: number;
  max_bytes?: number;
  reason: string;
}

export interface AdminSupportShowResponse {
  audit_id: string;
  server_time: string;
  ticket: AdminSupportTicketSummary & { description: string };
  comments: AdminSupportTicketComment[];
  result_bytes: number;
  truncated: boolean;
  redaction: "best_effort";
}

export interface AdminSupportTriageRequest extends AdminSupportListRequest {}

export interface AdminSupportTriageGroup {
  key: string;
  reason: "error_signature" | "subject_similarity" | "category";
  category: AdminSupportCategory;
  ticket_ids: number[];
  count: number;
  first_created_at: string;
  last_updated_at: string;
  project_ids: string[];
  error_signatures: string[];
  subjects: string[];
}

export interface AdminSupportTriageResponse extends Omit<
  AdminSupportListResponse,
  "tickets"
> {
  tickets: AdminSupportTicketSummary[];
  category_counts: Partial<Record<AdminSupportCategory, number>>;
  groups: AdminSupportTriageGroup[];
}

export interface AdminSupportSearchRequest {
  query: string;
  limit?: number;
  max_bytes?: number;
  reason: string;
}

export interface AdminSupportSearchResponse {
  audit_id: string;
  server_time: string;
  query: string;
  tickets: AdminSupportTicketSummary[];
  source_candidates: number;
  result_bytes: number;
  truncated: boolean;
  redaction: "best_effort";
  indexing_note: string;
}

export interface AdminSupportUpdateChanges {
  public_reply?: string;
  private_note?: string;
  status?: AdminSupportMutableTicketStatus;
  priority?: AdminSupportTicketPriority | null;
  assignee_id?: number | null;
  add_tags?: string[];
  remove_tags?: string[];
}

export interface AdminSupportUpdatePlanRequest extends AdminSupportUpdateChanges {
  ticket_id: number;
  expected_updated_at?: string;
  reason: string;
}

export interface AdminSupportMutationPreview {
  comment_kind?: "public_reply" | "private_note";
  comment_chars?: number;
  comment_sha256?: string;
  comment_preview?: string;
  status?: AdminSupportMutableTicketStatus;
  priority?: AdminSupportTicketPriority | null;
  assignee_id?: number | null;
  add_tags: string[];
  remove_tags: string[];
}

export interface AdminSupportUpdatePlanResponse {
  audit_id: string;
  operation: "update";
  commit: false;
  payload_hash: string;
  expected_updated_at: string;
  ticket_before: AdminSupportTicketSummary;
  changes: AdminSupportMutationPreview;
}

export interface AdminSupportUpdateRequest extends AdminSupportUpdatePlanRequest {
  expected_updated_at: string;
  idempotency_key: string;
  timeout?: number;
}

export interface AdminSupportUpdateResponse {
  audit_id: string;
  operation: "update";
  commit: true;
  payload_hash: string;
  idempotency_key: string;
  idempotent_replay: boolean;
  zendesk_audit_id?: number;
  comment?: AdminSupportAppliedComment;
  ticket: AdminSupportTicketSummary;
}

export interface AdminSupportAppliedComment {
  id: number;
  public: boolean;
  created_at: string;
  body_sha256: string;
  body_preview: string;
}

export interface AdminSupportMergePlanRequest {
  target_ticket_id: number;
  source_ticket_id: number;
  target_comment?: string;
  source_comment?: string;
  target_comment_public?: boolean;
  source_comment_public?: boolean;
  target_expected_updated_at?: string;
  source_expected_updated_at?: string;
  reason: string;
}

export interface AdminSupportMergePlanResponse {
  audit_id: string;
  operation: "merge";
  commit: false;
  payload_hash: string;
  target_expected_updated_at: string;
  source_expected_updated_at: string;
  target_ticket: AdminSupportTicketSummary;
  source_ticket: AdminSupportTicketSummary;
  target_comment?: AdminSupportMutationPreview;
  source_comment?: AdminSupportMutationPreview;
}

export interface AdminSupportMergeRequest extends AdminSupportMergePlanRequest {
  target_expected_updated_at: string;
  source_expected_updated_at: string;
  idempotency_key: string;
  timeout?: number;
}

export interface AdminSupportMergeResponse {
  audit_id: string;
  operation: "merge";
  commit: true;
  payload_hash: string;
  idempotency_key: string;
  idempotent_replay: boolean;
  zendesk_job_id?: string;
  zendesk_job_status: string;
  target_ticket: AdminSupportTicketSummary;
  source_ticket: AdminSupportTicketSummary;
}

export const adminSupport = {
  list: authFirstRequireAccount,
  show: authFirstRequireAccount,
  triage: authFirstRequireAccount,
  search: authFirstRequireAccount,
  planUpdate: authFirstRequireAccount,
  update: authFirstRequireAccount,
  planMerge: authFirstRequireAccount,
  merge: authFirstRequireAccount,
};

export interface AdminSupportApi {
  list: (opts: AdminSupportListRequest) => Promise<AdminSupportListResponse>;
  show: (opts: AdminSupportShowRequest) => Promise<AdminSupportShowResponse>;
  triage: (
    opts: AdminSupportTriageRequest,
  ) => Promise<AdminSupportTriageResponse>;
  search: (
    opts: AdminSupportSearchRequest,
  ) => Promise<AdminSupportSearchResponse>;
  planUpdate: (
    opts: AdminSupportUpdatePlanRequest,
  ) => Promise<AdminSupportUpdatePlanResponse>;
  update: (
    opts: AdminSupportUpdateRequest,
  ) => Promise<AdminSupportUpdateResponse>;
  planMerge: (
    opts: AdminSupportMergePlanRequest,
  ) => Promise<AdminSupportMergePlanResponse>;
  merge: (opts: AdminSupportMergeRequest) => Promise<AdminSupportMergeResponse>;
}
