/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

let getServerSettingsMock: jest.Mock;
let queryMock: jest.Mock;
let listConfiguredBaysMock: jest.Mock;
let getRemoteActiveUserMapMock: jest.Mock;

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: jest.fn(() => ({ query: queryMock })),
}));

jest.mock("@cocalc/database/settings/server-settings", () => ({
  getServerSettings: (...args: any[]) => getServerSettingsMock(...args),
}));

jest.mock("@cocalc/server/bay-config", () => ({
  getConfiguredBayId: () => "bay-1",
}));

jest.mock("@cocalc/server/bay-directory", () => ({
  listConfiguredBays: (...args: any[]) => listConfiguredBaysMock(...args),
}));

jest.mock("@cocalc/server/inter-bay/bridge", () => ({
  getInterBayBridge: () => ({
    bayOps: (bay_id: string, opts: unknown) => ({
      getActiveUserMap: (query: unknown) =>
        getRemoteActiveUserMapMock(bay_id, opts, query),
    }),
  }),
}));

describe("account presence locations", () => {
  beforeEach(() => {
    jest.resetModules();
    getServerSettingsMock = jest.fn(async () => ({
      active_user_map_enabled: true,
    }));
    queryMock = jest.fn(async () => ({ rows: [] }));
    listConfiguredBaysMock = jest.fn(async () => [{ bay_id: "bay-1" }]);
    getRemoteActiveUserMapMock = jest.fn();
  });

  it("normalizes approximate Cloudflare location fields", async () => {
    const { normalizeAccountPresenceLocation } =
      await import("./account-presence-locations");
    expect(
      normalizeAccountPresenceLocation({
        country_code: " us ",
        region_code: "WA",
        region: "Washington",
        city: "Seattle%20City",
        continent: "NA",
        timezone: "America/Los_Angeles",
        latitude: "47.61",
        longitude: "-122.33",
      }),
    ).toEqual({
      country_code: "US",
      region_code: "WA",
      region: "Washington",
      city: "Seattle City",
      continent: "NA",
      timezone: "America/Los_Angeles",
      latitude: 47.61,
      longitude: -122.33,
    });
    expect(
      normalizeAccountPresenceLocation({
        country_code: "XX",
        latitude: "0",
        longitude: "0",
      }),
    ).toBeUndefined();
  });

  it("writes one expiring location and throttles repeated heartbeats", async () => {
    const { recordAccountPresenceLocation } =
      await import("./account-presence-locations");
    const location = {
      country_code: "US",
      latitude: "47.61",
      longitude: "-122.33",
    };
    await expect(
      recordAccountPresenceLocation({ account_id: "account-1", location }),
    ).resolves.toBe(true);
    await expect(
      recordAccountPresenceLocation({ account_id: "account-1", location }),
    ).resolves.toBe(false);
    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][0]).toContain(
      "ON CONFLICT (account_id) DO UPDATE",
    );
    expect(queryMock.mock.calls[0][1]).toEqual([
      "account-1",
      "bay-1",
      26,
      "US",
      null,
      null,
      null,
      null,
      null,
      47.61,
      -122.33,
    ]);
  });

  it("does not collect location when the site setting is disabled", async () => {
    getServerSettingsMock.mockResolvedValue({
      active_user_map_enabled: false,
    });
    const { recordAccountPresenceLocation } =
      await import("./account-presence-locations");
    await expect(
      recordAccountPresenceLocation({
        account_id: "account-1",
        location: {
          country_code: "US",
          latitude: "47.61",
          longitude: "-122.33",
        },
      }),
    ).resolves.toBe(false);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("groups a one-day active-user query and keeps unknown users separate", async () => {
    queryMock.mockResolvedValue({
      rows: [
        {
          account_id: "account-1",
          display_name: "Ada",
          first_name: "Ada",
          last_name: "Lovelace",
          email_address: "ada@example.com",
          last_active: "2026-07-14T10:00:00.000Z",
          country_code: "GB",
          region_code: "ENG",
          region: "England",
          city: "London",
          timezone: "Europe/London",
          latitude: "51.5",
          longitude: "-0.12",
        },
        {
          account_id: "account-2",
          display_name: "Unknown",
          first_name: null,
          last_name: null,
          email_address: "unknown@example.com",
          last_active: "2026-07-14T09:00:00.000Z",
          country_code: null,
          region_code: null,
          region: null,
          city: null,
          timezone: null,
          latitude: null,
          longitude: null,
        },
      ],
    });
    const { getActiveUserMapOverview } =
      await import("./account-presence-locations");
    const result = await getActiveUserMapOverview({ active_minutes: 1440 });
    expect(queryMock.mock.calls[0][1]).toEqual([1440]);
    expect(result).toMatchObject({
      enabled: true,
      bay_id: "bay-1",
      current_bay_id: "bay-1",
      active_minutes: 1440,
      total_active: 2,
      mapped_active: 1,
      unknown_location: 1,
      countries: [
        {
          country_code: "GB",
          count: 1,
          latitude: 51.5,
          longitude: -0.12,
        },
      ],
    });
    expect(result.unknown_users.map(({ account_id }) => account_id)).toEqual([
      "account-2",
    ]);
    expect(result.countries[0].users[0].bay_id).toBe("bay-1");
  });

  it("aggregates configured bays and keeps the newest account activity", async () => {
    listConfiguredBaysMock.mockResolvedValue([
      { bay_id: "bay-1" },
      { bay_id: "bay-2" },
    ]);
    queryMock.mockResolvedValue({
      rows: [
        {
          account_id: "account-1",
          display_name: "Ada",
          first_name: "Ada",
          last_name: "Lovelace",
          email_address: "ada@example.com",
          last_active: "2026-07-14T09:00:00.000Z",
          country_code: "GB",
          region_code: "ENG",
          region: "England",
          city: "London",
          timezone: "Europe/London",
          latitude: "51.5",
          longitude: "-0.12",
        },
      ],
    });
    getRemoteActiveUserMapMock.mockResolvedValue({
      enabled: true,
      checked_at: "2026-07-14T10:00:00.000Z",
      bay_id: "bay-2",
      current_bay_id: "bay-2",
      active_minutes: 60,
      total_active: 2,
      mapped_active: 1,
      unknown_location: 1,
      countries: [
        {
          country_code: "US",
          latitude: 33.45,
          longitude: -112.07,
          count: 1,
          users: [
            {
              account_id: "account-1",
              bay_id: "bay-2",
              display_name: "Ada",
              first_name: "Ada",
              last_name: "Lovelace",
              email_address: "ada@example.com",
              last_active: "2026-07-14T10:00:00.000Z",
              region_code: "AZ",
              region: "Arizona",
              city: "Phoenix",
              timezone: "America/Phoenix",
            },
          ],
        },
      ],
      unknown_users: [
        {
          account_id: "account-2",
          bay_id: "bay-2",
          display_name: "Grace",
          first_name: "Grace",
          last_name: "Hopper",
          email_address: "grace@example.com",
          last_active: "2026-07-14T09:30:00.000Z",
          region_code: null,
          region: null,
          city: null,
          timezone: null,
        },
      ],
      bays: [{ bay_id: "bay-2", ok: true, enabled: true, total_active: 2 }],
    });

    const { getActiveUserMapOverviewAcrossBays } =
      await import("./account-presence-locations");
    const result = await getActiveUserMapOverviewAcrossBays({
      account_id: "admin-1",
      active_minutes: 60,
    });

    expect(getRemoteActiveUserMapMock).toHaveBeenCalledWith(
      "bay-2",
      { timeout_ms: 10_000 },
      { account_id: "admin-1", active_minutes: 60 },
    );
    expect(result).toMatchObject({
      bay_id: "all",
      current_bay_id: "bay-1",
      total_active: 2,
      mapped_active: 1,
      unknown_location: 1,
      bays: [
        { bay_id: "bay-1", ok: true, total_active: 1 },
        { bay_id: "bay-2", ok: true, total_active: 2 },
      ],
    });
    expect(result.countries[0]).toMatchObject({
      country_code: "US",
      count: 1,
      users: [
        {
          account_id: "account-1",
          bay_id: "bay-2",
          city: "Phoenix",
        },
      ],
    });
  });

  it("returns local activity and reports an unavailable remote bay", async () => {
    listConfiguredBaysMock.mockResolvedValue([
      { bay_id: "bay-1" },
      { bay_id: "bay-2" },
    ]);
    getRemoteActiveUserMapMock.mockRejectedValue(Error("bay offline"));

    const { getActiveUserMapOverviewAcrossBays } =
      await import("./account-presence-locations");
    const result = await getActiveUserMapOverviewAcrossBays({
      account_id: "admin-1",
      active_minutes: 15,
    });

    expect(result.total_active).toBe(0);
    expect(result.bays).toEqual([
      { bay_id: "bay-1", ok: true, enabled: true, total_active: 0 },
      { bay_id: "bay-2", ok: false, error: "Error: bay offline" },
    ]);
  });

  it("rejects activity windows that are not explicitly supported", async () => {
    const { getActiveUserMapOverview } =
      await import("./account-presence-locations");
    await expect(
      getActiveUserMapOverview({ active_minutes: 30 }),
    ).rejects.toThrow("active_minutes must be one of 5, 15, 60, or 1440");
    expect(queryMock).not.toHaveBeenCalled();
  });
});
