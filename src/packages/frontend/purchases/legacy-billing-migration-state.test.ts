/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { LegacyMigrationFinancialPreviewResponse } from "@cocalc/conat/hub/api/legacy-migration";

import { activeLegacyMembershipGrantClass } from "./legacy-billing-migration-state";

function preview(
  values: Partial<LegacyMigrationFinancialPreviewResponse>,
): LegacyMigrationFinancialPreviewResponse {
  return values as LegacyMigrationFinancialPreviewResponse;
}

describe("activeLegacyMembershipGrantClass", () => {
  const now = new Date("2026-08-04T00:00:00Z").getTime();

  it("returns the class for an active grant", () => {
    expect(
      activeLegacyMembershipGrantClass(
        preview({
          applied_membership_class: "member",
          membership_grant_ends_at: "2026-08-05T00:00:00Z",
        }),
        now,
      ),
    ).toBe("member");
  });

  it.each([
    ["missing expiration", { applied_membership_class: "member" }],
    [
      "expired grant",
      {
        applied_membership_class: "member",
        membership_grant_ends_at: "2026-08-03T00:00:00Z",
      },
    ],
    [
      "invalid expiration",
      {
        applied_membership_class: "member",
        membership_grant_ends_at: "invalid",
      },
    ],
    ["missing class", { membership_grant_ends_at: "2026-08-05T00:00:00Z" }],
  ])("returns null for a %s", (_label, values) => {
    expect(activeLegacyMembershipGrantClass(preview(values), now)).toBeNull();
  });
});
