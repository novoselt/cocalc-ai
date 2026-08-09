/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getPoolClient } from "@cocalc/database/pool";
import {
  ensureGrowthAnalyticsSchema,
  resetGrowthAnalyticsSchemaForTests,
} from "./schema";

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  getPoolClient: jest.fn(),
}));

describe("growth analytics schema", () => {
  beforeEach(() => resetGrowthAnalyticsSchemaForTests());

  it("creates canonical facts, restart state, and serving tables", async () => {
    const query = jest.fn(async () => ({ rows: [] }));
    const release = jest.fn();
    (getPoolClient as jest.Mock).mockResolvedValue({ query, release });
    await ensureGrowthAnalyticsSchema();
    const sql = query.mock.calls.map(([statement]) => statement).join("\n");
    expect(query.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
    expect(sql).toContain("growth_account_activity_daily");
    expect(sql).toContain("growth_materialization_state");
    expect(sql).toContain("growth_retention_cells");
    expect(sql).toContain("growth_weekly_accounting");
    expect(sql).toContain("growth_event_log_watermark_idx");
    expect(sql).toContain("growth_event_log_home_watermark_idx");
    expect(sql).toContain("ALTER COLUMN received_at SET DEFAULT NOW()");
    expect(sql).toContain("ALTER COLUMN received_at SET NOT NULL");
    expect(sql).toContain(
      "ALTER COLUMN source_watermark SET DEFAULT '{}'::jsonb",
    );
    expect(sql).toContain("ALTER COLUMN source_watermark SET NOT NULL");
    expect(sql).toContain("ALTER COLUMN coverage_started_at SET DEFAULT NOW()");
    expect(sql).toContain("ALTER COLUMN coverage_started_at SET NOT NULL");
  });
});
