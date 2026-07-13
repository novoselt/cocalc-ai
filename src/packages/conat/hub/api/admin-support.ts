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

export const adminSupport = {
  list: authFirstRequireAccount,
  show: authFirstRequireAccount,
  triage: authFirstRequireAccount,
};

export interface AdminSupportApi {
  list: (opts: AdminSupportListRequest) => Promise<AdminSupportListResponse>;
  show: (opts: AdminSupportShowRequest) => Promise<AdminSupportShowResponse>;
  triage: (
    opts: AdminSupportTriageRequest,
  ) => Promise<AdminSupportTriageResponse>;
}
