/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  DocumentBuildCapabilities,
  DocumentBuildRequest,
  DocumentBuildSnapshot,
} from "@cocalc/app-document-build";

export const documentBuild = {
  capabilities: true,
  start: true,
  get: true,
  getActive: true,
  getRecent: true,
  cancel: true,
} as const;

export interface DocumentBuildApi {
  capabilities(): Promise<DocumentBuildCapabilities>;
  start(request: DocumentBuildRequest): Promise<DocumentBuildSnapshot>;
  get(build_id: string): Promise<DocumentBuildSnapshot>;
  getActive(query?: { path?: string }): Promise<DocumentBuildSnapshot[]>;
  getRecent(query?: {
    path?: string;
    limit?: number;
  }): Promise<DocumentBuildSnapshot[]>;
  cancel(build_id: string): Promise<DocumentBuildSnapshot>;
}
