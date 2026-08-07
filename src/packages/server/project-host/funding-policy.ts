/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { AccountLocalDedicatedHostPolicySnapshot } from "@cocalc/conat/inter-bay/api";

/**
 * An explicit account-postpaid admin override authorizes manual collection.
 * Normal postpaid accounts must still have Stripe automatic billing enabled.
 */
export function isTrustedAdminPostpaid(
  snapshot: AccountLocalDedicatedHostPolicySnapshot,
): boolean {
  return (
    snapshot.admin_override?.dedicated_hosts?.funding_mode?.value ===
    "account-postpaid"
  );
}
