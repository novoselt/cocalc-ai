/*
 *  This file is part of CoCalc: Copyright © 2026, SageMath, Inc.
 *  License: MS-RSL – see https://github.com/sagemathinc/cocalc-ai/blob/master/LICENSE.md
 */

const getServerSettings = jest.fn();

jest.mock("@cocalc/database/settings/server-settings", () => ({
  getServerSettings: (...args: unknown[]) => getServerSettings(...args),
}));

import { reconcileSiteFundedCodexCosts } from "./site-funded-codex-reconciliation";

const pools = [
  {
    poolId: "site-funded-codex-free" as const,
    periodStart: "2026-07-27T00:00:00.000Z",
    periodEnd: "2026-08-03T00:00:00.000Z",
    limitMicrousd: 100_000_000,
    reservedMicrousd: 10_000,
    committedMicrousd: 60_000,
    activeReservations: 1,
    utilization: 0.0007,
  },
];

afterEach(() => {
  jest.restoreAllMocks();
  getServerSettings.mockReset();
});

it("reports reconciliation as unavailable without admin credentials", async () => {
  getServerSettings.mockResolvedValue({});
  await expect(reconcileSiteFundedCodexCosts(pools)).resolves.toMatchObject({
    available: false,
    localCommittedMicrousd: 60_000,
  });
});

it("compares provider project cost with the local committed ledger", async () => {
  getServerSettings.mockResolvedValue({
    site_funded_codex_openai_admin_key: "admin-key",
    site_funded_codex_openai_project_id: "proj_funded",
  });
  const fetchMock = jest.spyOn(global, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        data: [
          {
            results: [
              {
                amount: { value: 0.065, currency: "usd" },
                project_id: "proj_funded",
              },
            ],
          },
        ],
        has_more: false,
      }),
      { status: 200 },
    ),
  );

  await expect(reconcileSiteFundedCodexCosts(pools)).resolves.toMatchObject({
    available: true,
    providerCostMicrousd: 65_000,
    localCommittedMicrousd: 60_000,
    discrepancyMicrousd: 5_000,
  });
  expect(fetchMock).toHaveBeenCalledWith(
    expect.objectContaining({
      pathname: "/v1/organization/costs",
    }),
    expect.objectContaining({
      headers: expect.objectContaining({
        Authorization: "Bearer admin-key",
      }),
    }),
  );
});
