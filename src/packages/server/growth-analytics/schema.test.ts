/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { getPoolClient } from "@cocalc/database/pool";
import {
  ensureGrowthAnalyticsSchema,
  resetGrowthAnalyticsSchemaForTests,
} from "./schema";
import { SCHEMA } from "@cocalc/util/db-schema";

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  getPoolClient: jest.fn(),
}));

describe("growth analytics schema", () => {
  beforeEach(() => resetGrowthAnalyticsSchemaForTests());

  it("repairs invariants without duplicating db-schema table ownership", async () => {
    const query = jest.fn(async () => ({ rows: [] }));
    const release = jest.fn();
    (getPoolClient as jest.Mock).mockResolvedValue({ query, release });
    await ensureGrowthAnalyticsSchema();
    const sql = query.mock.calls.map(([statement]) => statement).join("\n");
    expect(query.mock.calls[0]?.[0]).toBe("BEGIN");
    expect(query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
    expect(release).toHaveBeenCalledTimes(1);
    expect(sql).not.toContain("CREATE TABLE");
    expect(sql).not.toContain("CREATE INDEX");
    expect(sql).toContain("ALTER COLUMN received_at SET DEFAULT NOW()");
    expect(sql).toContain("ALTER COLUMN received_at SET NOT NULL");
    expect(sql).toContain(
      "ALTER COLUMN source_watermark SET DEFAULT '{}'::jsonb",
    );
    expect(sql).toContain("ALTER COLUMN source_watermark SET NOT NULL");
    expect(sql).toContain("ALTER COLUMN coverage_started_at SET DEFAULT NOW()");
    expect(sql).toContain("ALTER COLUMN coverage_started_at SET NOT NULL");
  });

  it("declares compound serving indexes in db-schema", () => {
    expect(
      SCHEMA.growth_event_log.pg_custom_indexes?.map(({ name }) => name),
    ).toEqual(
      expect.arrayContaining([
        "growth_event_log_watermark_idx",
        "growth_event_log_home_watermark_idx",
      ]),
    );
    expect(
      SCHEMA.growth_account_profiles.pg_custom_indexes?.map(({ name }) => name),
    ).toContain("growth_account_profiles_cohort_date_account_idx");
    expect(
      SCHEMA.analytics.pg_custom_indexes?.map(({ name }) => name),
    ).toContain("analytics_account_growth_idx");
  });
});
