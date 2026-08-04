/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool from "@cocalc/database/pool";
import { after, before } from "@cocalc/server/test";
import { uuid } from "@cocalc/util/misc";
import { getAIUsageStatus } from "./usage-status";
import { recordSiteFundedCodexAccountUsage } from "./save-response";

const accountId = uuid();
const fundedTurnId = uuid();
const projectId = uuid();

beforeAll(async () => {
  await before({ noConat: true });
  await getPool().query(
    `INSERT INTO accounts(account_id, created, email_address)
     VALUES($1, NOW(), $2)`,
    [accountId, `${accountId}@example.com`],
  );
});

afterAll(after);

describe("exact account AI usage ledger", () => {
  it("records a funded turn exactly once and exposes its exact usage", async () => {
    const usage = {
      account_id: accountId,
      funded_turn_id: fundedTurnId,
      project_id: projectId,
      cost_microusd: 71_234,
    };
    await recordSiteFundedCodexAccountUsage(usage);
    await recordSiteFundedCodexAccountUsage(usage);

    const { rows } = await getPool().query(
      `SELECT COUNT(*)::int AS count, MAX(cost_microusd) AS cost_microusd
       FROM ai_usage_log WHERE funded_turn_id = $1`,
      [fundedTurnId],
    );
    expect(rows[0]).toMatchObject({ count: 1 });
    expect(Number(rows[0].cost_microusd)).toBe(71_234);

    const status = await getAIUsageStatus({ account_id: accountId });
    expect(status.windows.find(({ window }) => window === "5h")?.used).toBe(
      7.1234,
    );
    expect(status.windows.find(({ window }) => window === "7d")?.used).toBe(
      7.1234,
    );
  });
});
