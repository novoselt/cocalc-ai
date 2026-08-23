/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { ensureAccountBanAuditLogSchema } from "@cocalc/server/accounts/ban-audit";
import { ensureAccountBanTimestampSchema } from "@cocalc/server/accounts/ban-timestamp";
import { ensureClusterAccountDirectorySchema } from "@cocalc/server/accounts/cluster-directory";

export const PROJECT_ARCHIVE_LIFECYCLE_TABLE = "project_archive_lifecycle_jobs";

let schemaReady: Promise<void> | undefined;

export async function ensureProjectArchiveLifecycleSchema(): Promise<void> {
  schemaReady ??= (async () => {
    await Promise.all([
      ensureAccountBanTimestampSchema(),
      ensureAccountBanAuditLogSchema(),
      ensureClusterAccountDirectorySchema(),
    ]);
  })().catch((err) => {
    schemaReady = undefined;
    throw err;
  });
  await schemaReady;
}

export function resetProjectArchiveLifecycleSchemaForTests(): void {
  schemaReady = undefined;
}
