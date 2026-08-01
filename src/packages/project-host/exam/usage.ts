/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getRow } from "@cocalc/lite/hub/sqlite/database";

export function getExamUsageAccountId(account_id: string): string | undefined {
  const row = getRow("accounts", JSON.stringify({ account_id }));
  const usageAccountId = `${row?.usage_account_id ?? ""}`.trim();
  return usageAccountId || undefined;
}
