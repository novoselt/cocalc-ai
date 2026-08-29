/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ClaimableMembershipPackage } from "@cocalc/conat/hub/api/purchases";

export const SITE_LICENSE_REMINDER_DISMISSALS =
  "site_license_reminder_dismissals";

export type SiteLicenseReminderDismissals = Record<string, number>;

export function siteLicenseReminderKey(
  opportunity: ClaimableMembershipPackage,
): string {
  const siteLicenseId = `${opportunity.site_license_id ?? ""}`.trim();
  return siteLicenseId || `package:${opportunity.package_id}`;
}

export function normalizeSiteLicenseReminderDismissals(
  value: unknown,
): SiteLicenseReminderDismissals {
  const plain = (value as any)?.toJS?.() ?? value;
  if (plain == null || typeof plain !== "object" || Array.isArray(plain)) {
    return {};
  }
  const result: SiteLicenseReminderDismissals = {};
  for (const [key, dismissedAt] of Object.entries(plain)) {
    if (
      key &&
      typeof dismissedAt === "number" &&
      Number.isFinite(dismissedAt)
    ) {
      result[key] = dismissedAt;
    }
  }
  return result;
}
