/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getUsageLimitsItems } from "./usage-limit-items";

describe("getUsageLimitsItems", () => {
  it("includes compute, blob, and public-sharing limits", () => {
    const items = getUsageLimitsItems({
      blob_account_count: 100,
      blob_account_total_bytes: 2_000_000_000,
      blob_project_count: 20,
      blob_project_total_bytes: 500_000_000,
      cpu_5h_seconds: 7200,
      cpu_7d_seconds: 36_000,
      credit_spend_limit_7d_usd: 25,
      max_sponsored_running_projects: 3,
      prepaid_host_usage_limit_5h_usd: 10,
      public_directory_shares: 5,
    });
    const byKey = Object.fromEntries(
      items.map(({ key, value }) => [key, value]),
    );

    expect(byKey.cpu_5h_seconds).toBe("2 CPU-hours");
    expect(byKey.cpu_7d_seconds).toBe("10 CPU-hours");
    expect(byKey.blob_account_total_bytes).toBe("2 GB");
    expect(byKey.blob_account_count).toBe("100");
    expect(byKey.blob_project_total_bytes).toBe("500 MB");
    expect(byKey.blob_project_count).toBe("20");
    expect(byKey.max_sponsored_running_projects).toBe("3");
    expect(byKey.public_directory_shares).toBe("5");
    expect(byKey.prepaid_host_usage_limit_5h_usd).toBe("$10.00");
    expect(byKey.credit_spend_limit_7d_usd).toBe("$25.00");
  });
});
