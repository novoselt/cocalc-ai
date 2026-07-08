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

export const adminHost = {
  logs: authFirstRequireAccount,
};

export interface AdminHostApi {
  logs: (opts: AdminHostLogsRequest) => Promise<AdminHostLogsResponse>;
}
