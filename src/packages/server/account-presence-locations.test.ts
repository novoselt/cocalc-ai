/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

let getServerSettingsMock: jest.Mock;
let queryMock: jest.Mock;

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

describe("account presence locations", () => {
  beforeEach(() => {
    jest.resetModules();
    getServerSettingsMock = jest.fn(async () => ({
      active_user_map_enabled: true,
    }));
    queryMock = jest.fn(async () => ({ rows: [] }));
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
