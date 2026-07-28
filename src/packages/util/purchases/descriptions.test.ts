/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  TEAM_LICENSE_CHANGE,
  TEAM_LICENSE_RENEWAL,
} from "@cocalc/util/db-schema/purchases";
import {
  formatMembershipCreditPurchaseDescription,
  formatMembershipDebitPurchaseDescription,
  formatTeamLicenseCreditPurchaseDescription,
  formatTeamLicenseDebitPurchaseDescription,
} from "./descriptions";

describe("purchase descriptions", () => {
  it("keeps membership credit and debit wording aligned", () => {
    const labels = { pro: "Pro" };

    for (const interval of ["month", "year"] as const) {
      const creditDescription = formatMembershipCreditPurchaseDescription({
        interval,
        membershipLabel: labels.pro,
      });
      const debitDescription = formatMembershipDebitPurchaseDescription({
        description: {
          class: "pro",
          interval,
        },
        labels,
      });

      expect(debitDescription).toEqual(creditDescription);
    }
  });

  it("keeps team-license credit and debit wording aligned", () => {
    for (const type of [TEAM_LICENSE_CHANGE, TEAM_LICENSE_RENEWAL]) {
      const creditDescription =
        formatTeamLicenseCreditPurchaseDescription(type);
      const debitDescription = formatTeamLicenseDebitPurchaseDescription({
        type,
      });

      expect(debitDescription).toEqual(creditDescription);
    }
  });
});
