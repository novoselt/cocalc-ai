/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { LegacyMigrationFinancialPreviewResponse } from "@cocalc/conat/hub/api/legacy-migration";

export function activeLegacyMembershipGrantClass(
  preview: LegacyMigrationFinancialPreviewResponse | undefined,
  now = Date.now(),
): string | null {
  const membershipClass = `${preview?.applied_membership_class ?? ""}`.trim();
  const expiration = preview?.membership_grant_ends_at
    ? new Date(preview.membership_grant_ends_at).getTime()
    : Number.NaN;
  return membershipClass && Number.isFinite(expiration) && expiration > now
    ? membershipClass
    : null;
}
