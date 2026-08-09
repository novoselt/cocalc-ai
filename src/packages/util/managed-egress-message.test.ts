/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { formatManagedEgressPolicyDetails } from "./managed-egress-message";

describe("formatManagedEgressPolicyDetails", () => {
  it("identifies a seven-day block and reports both category windows", () => {
    expect(
      formatManagedEgressPolicyDetails({
        blocked_by: "7d",
        managed_egress_5h_bytes: 0,
        managed_egress_7d_bytes: 4_050_000_000,
        egress_5h_bytes: 2_000_000_000,
        egress_7d_bytes: 3_500_000_000,
        managed_egress_categories_5h_bytes: {},
        managed_egress_categories_7d_bytes: {
          "backup-upload": 1_550_000_000,
          "file-download": 1_950_000_000,
          "raw-network": 550_000_000,
        },
      }),
    ).toEqual([
      "Limit triggered by the 7-day network usage window.",
      "5-hour usage: 0 bytes / 2 GB.",
      "7-day usage: 4.1 GB / 3.5 GB.",
      "7-day network usage by category: Project backup uploads: 1.6 GB, File downloads: 2 GB, Project outbound network traffic: 550 MB.",
    ]);
  });

  it("omits absent limits and empty or invalid category values", () => {
    expect(
      formatManagedEgressPolicyDetails({
        blocked_by: "5h",
        managed_egress_categories_5h_bytes: {
          ssh: 0,
          unknown_category: Number.NaN,
        },
      }),
    ).toEqual(["Limit triggered by the 5-hour network usage window."]);
  });
});
