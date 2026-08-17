/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { PoolClient } from "@cocalc/database/pool";
import type {
  MembershipAllocationLifecycle,
  TeamLicenseQuoteLineItem,
} from "@cocalc/conat/hub/api/purchases";
import { recordMembershipAllocationFact } from "./allocation-analytics";

export async function recordTeamLicensePurchaseFacts({
  team_license_id,
  account_id,
  purchase_id,
  occurred_at = new Date(),
  period_start,
  period_end,
  lifecycle,
  line_items,
  client,
}: {
  team_license_id: string;
  account_id: string;
  purchase_id: number;
  occurred_at?: Date;
  period_start: Date | string;
  period_end: Date | string;
  lifecycle: MembershipAllocationLifecycle;
  line_items: TeamLicenseQuoteLineItem[];
  client: PoolClient;
}): Promise<number> {
  let recorded = 0;
  for (const line of line_items) {
    if (!line.membership_class || line.seat_count <= 0 || line.amount <= 0) {
      continue;
    }
    if (
      await recordMembershipAllocationFact({
        fact_key: `team-license:${team_license_id}:${purchase_id}:${line.membership_class}`,
        occurred_at,
        account_id,
        channel: "team",
        source_kind: "purchase",
        membership_class: line.membership_class,
        billing_interval: "year",
        lifecycle,
        allocation_start: period_start,
        allocation_end: period_end,
        purchased_capacity: line.seat_count,
        revenue: line.amount,
        purchase_id,
        client,
      })
    ) {
      recorded += 1;
    }
  }
  return recorded;
}
