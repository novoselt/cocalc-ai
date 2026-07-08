/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { authFirstRequireAccount } from "./util";
import type { HostRuntimeLogSource } from "@cocalc/conat/project-host/api";

export interface AdminHostLogsRequest {
  host_id: string;
  source?: HostRuntimeLogSource;
  lines?: number;
  grep?: string;
  max_bytes?: number;
  reason?: string;
}

export interface AdminHostLogsResponse {
  audit_id: string;
  host_id: string;
  source: string;
  requested_source?: HostRuntimeLogSource;
  server_time: string;
  lines: number;
  text: string;
  result_bytes: number;
  truncated: boolean;
}

export interface AdminHostDescribeRequest {
  host?: string;
  host_id?: string;
  recent_limit?: number;
  include_live?: boolean;
  reason?: string;
}

export interface AdminHostEvent {
  timestamp: string;
  category:
    | "availability"
    | "lro"
    | "heartbeat"
    | "host-record"
    | "operator_action";
  summary: string;
  details?: Record<string, unknown>;
}

export interface AdminHostDescribeResponse {
  audit_id: string;
  host_id: string;
  server_time: string;
  host: Record<string, unknown>;
  heartbeat_age_ms?: number;
  project_counts: Record<string, number>;
  recent_lros: Record<string, unknown>[];
  availability_events: Record<string, unknown>[];
  host_agent_status?: Record<string, unknown>;
  managed_components?: Record<string, unknown>[];
  live_errors?: string[];
}

export interface AdminHostEventsRequest {
  host?: string;
  host_id?: string;
  since_minutes?: number;
  limit?: number;
  reason?: string;
}

export interface AdminHostEventsResponse {
  audit_id: string;
  host_id: string;
  server_time: string;
  events: AdminHostEvent[];
  truncated: boolean;
}

export interface AdminHostTopRequest {
  host?: string;
  host_id?: string;
  window_minutes?: number;
  max_points?: number;
  reason?: string;
}

export interface AdminHostTopResponse {
  audit_id: string;
  host_id: string;
  server_time: string;
  window_minutes: number;
  point_count: number;
  current?: Record<string, unknown>;
  derived?: Record<string, unknown>;
  growth?: Record<string, unknown>;
  points?: Record<string, unknown>[];
}

export const adminHost = {
  describe: authFirstRequireAccount,
  events: authFirstRequireAccount,
  logs: authFirstRequireAccount,
  top: authFirstRequireAccount,
};

export interface AdminHostApi {
  describe: (
    opts: AdminHostDescribeRequest,
  ) => Promise<AdminHostDescribeResponse>;
  events: (opts: AdminHostEventsRequest) => Promise<AdminHostEventsResponse>;
  logs: (opts: AdminHostLogsRequest) => Promise<AdminHostLogsResponse>;
  top: (opts: AdminHostTopRequest) => Promise<AdminHostTopResponse>;
}
