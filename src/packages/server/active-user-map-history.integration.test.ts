/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { after, before, getPool } from "@cocalc/server/test";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { COOKIE_CONSENT_REVISION } from "@cocalc/util/cookie-consent";
import { uuid } from "@cocalc/util/misc";
import {
  aggregateActiveUserMapHistoryReports,
  getActiveUserMapHistorySeries,
  getActiveUserMapHistorySnapshot,
  getActiveUserMapHistoryReport,
  pruneActiveUserMapHistory,
  storeActiveUserMapHistorySnapshots,
} from "./active-user-map-history";

beforeAll(async () => {
  await before({ noConat: true });
}, 15_000);
afterAll(after);

describe("active user map history database integration", () => {
  it("separates consent, unknown location, and mapped activity", async () => {
    const accountIds = [uuid(), uuid(), uuid(), uuid()];
    const bayId = getConfiguredBayId();
    try {
      await getPool().query(
        `INSERT INTO accounts
           (account_id, created, last_active, home_bay_id, other_settings)
         VALUES
           ($1, NOW(), NOW(), $5, $6::jsonb),
           ($2, NOW(), NOW(), $5, $7::jsonb),
           ($3, NOW(), NOW(), $5, $6::jsonb),
           ($4, NOW(), NOW(), $5, $8::jsonb)`,
        [
          ...accountIds,
          bayId,
          JSON.stringify({
            cookie_consent: {
              revision: COOKIE_CONSENT_REVISION,
              usage: true,
            },
          }),
          JSON.stringify({
            cookie_consent: {
              revision: COOKIE_CONSENT_REVISION,
              usage: false,
            },
          }),
          JSON.stringify({
            cookie_consent: {
              revision: COOKIE_CONSENT_REVISION - 1,
              usage: true,
            },
          }),
        ],
      );
      await getPool().query(
        `INSERT INTO account_presence_locations
           (account_id, bay_id, observed_at, expire, country_code,
            latitude, longitude)
         VALUES
           ($1, $4, NOW(), NOW() + INTERVAL '1 hour', 'GB', 51.5, -0.12),
           ($2, $4, NOW(), NOW() + INTERVAL '1 hour', 'US', 47.61, -122.33),
           ($3, $4, NOW(), NOW() + INTERVAL '1 hour', 'CA', 53.55, -113.49)`,
        [accountIds[0], accountIds[1], accountIds[3], bayId],
      );

      const consentReport = await getActiveUserMapHistoryReport({
        usage_metrics_consent_required: true,
        captured_at: new Date(Date.now() + 1000).toISOString(),
      });
      const consentAccounts = new Set(accountIds);
      consentReport.accounts = consentReport.accounts.filter(({ account_id }) =>
        consentAccounts.has(account_id),
      );
      const [consentSnapshot] = aggregateActiveUserMapHistoryReports({
        reports: [consentReport],
        captured_at: new Date(Date.now() + 1000),
      });
      expect(consentSnapshot).toMatchObject({
        total_active: 4,
        mapped_active: 1,
        unknown_location: 1,
        usage_metrics_not_enabled: 2,
        countries: [{ country_code: "GB", active_count: 1 }],
      });

      const unrestrictedReport = await getActiveUserMapHistoryReport({
        usage_metrics_consent_required: false,
        captured_at: new Date(Date.now() + 1000).toISOString(),
      });
      unrestrictedReport.accounts = unrestrictedReport.accounts.filter(
        ({ account_id }) => consentAccounts.has(account_id),
      );
      const [unrestrictedSnapshot] = aggregateActiveUserMapHistoryReports({
        reports: [unrestrictedReport],
        captured_at: new Date(Date.now() + 1000),
      });
      expect(unrestrictedSnapshot).toMatchObject({
        total_active: 4,
        mapped_active: 3,
        unknown_location: 1,
        usage_metrics_not_enabled: 0,
        countries: [
          { country_code: "CA", active_count: 1 },
          { country_code: "GB", active_count: 1 },
          { country_code: "US", active_count: 1 },
        ],
      });
    } finally {
      await getPool().query(
        "DELETE FROM account_presence_locations WHERE account_id = ANY($1::uuid[])",
        [accountIds],
      );
      await getPool().query(
        "DELETE FROM accounts WHERE account_id = ANY($1::uuid[])",
        [accountIds],
      );
    }
  });

  it("retains snapshots by default and supports explicit pruning", async () => {
    const client = await getPool().connect();
    const old = new Date("2038-05-31T12:15:00.000Z");
    const recent = new Date("2038-06-02T12:15:00.000Z");
    const now = new Date("2040-06-01T12:15:00.000Z");
    const hours = [old, recent].map((date) => {
      const hour = new Date(date);
      hour.setUTCMinutes(0, 0, 0);
      return hour;
    });
    try {
      for (const captured_at of [old, recent]) {
        await storeActiveUserMapHistorySnapshots({
          client,
          captured_at,
          bay_count: 2,
          snapshots: [
            {
              active_minutes: 60,
              total_active: 12,
              mapped_active: 10,
              unknown_location: 1,
              usage_metrics_not_enabled: 1,
              countries: [{ country_code: "CA", active_count: 10 }],
            },
          ],
        });
      }

      await expect(pruneActiveUserMapHistory({ client, now })).resolves.toEqual(
        { countries: 0, snapshots: 0 },
      );
      await expect(
        client.query(
          `SELECT COUNT(*)::int AS count
             FROM active_user_map_history_snapshots
            WHERE snapshot_hour = ANY($1::timestamptz[])`,
          [hours],
        ),
      ).resolves.toMatchObject({ rows: [{ count: 2 }] });

      await expect(
        pruneActiveUserMapHistory({
          client,
          now,
          retentionMonths: 24,
        }),
      ).resolves.toEqual({ countries: 1, snapshots: 1 });
      const snapshots = await client.query(
        `SELECT snapshot_hour, total_active, mapped_active,
                unknown_location, usage_metrics_not_enabled, bay_count
           FROM active_user_map_history_snapshots
          WHERE snapshot_hour = ANY($1::timestamptz[])
          ORDER BY snapshot_hour`,
        [hours],
      );
      expect(snapshots.rows).toEqual([
        {
          snapshot_hour: hours[1],
          total_active: 12,
          mapped_active: 10,
          unknown_location: 1,
          usage_metrics_not_enabled: 1,
          bay_count: 2,
        },
      ]);
      const countries = await client.query(
        `SELECT country_code, active_count
           FROM active_user_map_history_countries
          WHERE snapshot_hour = ANY($1::timestamptz[])`,
        [hours],
      );
      expect(countries.rows).toEqual([
        { country_code: "CA", active_count: 10 },
      ]);
    } finally {
      await client.query(
        `DELETE FROM active_user_map_history_countries
          WHERE snapshot_hour = ANY($1::timestamptz[])`,
        [hours],
      );
      await client.query(
        `DELETE FROM active_user_map_history_snapshots
          WHERE snapshot_hour = ANY($1::timestamptz[])`,
        [hours],
      );
      client.release();
    }
  });

  it("returns the latest 24-hour snapshot for each UTC day", async () => {
    const client = await getPool().connect();
    const captured = [
      new Date("2041-05-20T12:15:00.000Z"),
      new Date("2041-06-01T10:15:00.000Z"),
      new Date("2041-06-01T20:15:00.000Z"),
      new Date("2041-06-02T08:15:00.000Z"),
    ];
    const hours = captured.map((date) => {
      const hour = new Date(date);
      hour.setUTCMinutes(0, 0, 0);
      return hour;
    });
    try {
      for (const [index, captured_at] of captured.entries()) {
        await storeActiveUserMapHistorySnapshots({
          client,
          captured_at,
          bay_count: 2,
          snapshots: [
            {
              active_minutes: 1440,
              total_active: 10 * (index + 1),
              mapped_active: 8 * (index + 1),
              unknown_location: index + 1,
              usage_metrics_not_enabled: index + 1,
              countries: [
                { country_code: "A1", active_count: 7 * (index + 1) },
                { country_code: "CA", active_count: index + 1 },
              ],
            },
          ],
        });
      }

      await expect(
        getActiveUserMapHistorySeries({
          client,
          active_minutes: 1440,
          days: 3,
          now: new Date("2041-06-03T23:00:00.000Z"),
        }),
      ).resolves.toEqual({
        active_minutes: 1440,
        days: 3,
        country_code: null,
        country_codes: ["A1", "CA"],
        points: [
          {
            snapshot_hour: hours[2].toISOString(),
            captured_at: captured[2].toISOString(),
            total_active: 30,
            mapped_active: 24,
            unknown_location: 3,
            usage_metrics_not_enabled: 3,
            bay_count: 2,
            active_count: 30,
          },
          {
            snapshot_hour: hours[3].toISOString(),
            captured_at: captured[3].toISOString(),
            total_active: 40,
            mapped_active: 32,
            unknown_location: 4,
            usage_metrics_not_enabled: 4,
            bay_count: 2,
            active_count: 40,
          },
        ],
      });

      await expect(
        getActiveUserMapHistorySeries({
          client,
          active_minutes: 1440,
          country_code: "ca",
          days: 3,
          now: new Date("2041-06-03T23:00:00.000Z"),
        }),
      ).resolves.toMatchObject({
        country_code: "CA",
        points: [{ active_count: 3 }, { active_count: 4 }],
      });

      await expect(
        getActiveUserMapHistorySeries({
          client,
          active_minutes: 1440,
          country_code: "a1",
          days: 3,
          now: new Date("2041-06-03T23:00:00.000Z"),
        }),
      ).resolves.toMatchObject({
        country_code: "A1",
        points: [{ active_count: 21 }, { active_count: 28 }],
      });

      await expect(
        getActiveUserMapHistorySnapshot({
          client,
          active_minutes: 1440,
          snapshot_hour: "2041-06-01T18:00:00.000Z",
          direction: "forward",
        }),
      ).resolves.toMatchObject({
        snapshot_hour: hours[2].toISOString(),
        total_active: 30,
        countries: [
          { country_code: "A1", count: 21 },
          { country_code: "CA", count: 3 },
        ],
      });
    } finally {
      await client.query(
        `DELETE FROM active_user_map_history_countries
          WHERE snapshot_hour = ANY($1::timestamptz[])`,
        [hours],
      );
      await client.query(
        `DELETE FROM active_user_map_history_snapshots
          WHERE snapshot_hour = ANY($1::timestamptz[])`,
        [hours],
      );
      client.release();
    }
  });
});
