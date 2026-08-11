/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const publishMock = jest.fn();
const publishSyncMock = jest.fn();
const closeMock = jest.fn();
const astreamMock = jest.fn(() => ({
  publish: publishMock,
  close: closeMock,
}));

jest.mock("@cocalc/backend/conat", () => ({
  conat: () => ({
    publishSync: publishSyncMock,
    sync: { astream: astreamMock },
  }),
}));

jest.mock("@cocalc/conat/hub/api/account-feed", () => ({
  ACCOUNT_FEED_STREAM_CONFIG: {
    max_msgs: 1000,
    max_age: 15 * 60 * 1000,
  },
  accountFeedLiveSubject: (account_id: string) =>
    `account.${account_id}.account-feed-live`,
  accountFeedStreamName: () => "account-feed",
}));

import { publishAccountFeedEvent } from "./feed";

describe("publishAccountFeedEvent", () => {
  beforeEach(() => {
    publishMock.mockReset();
    publishMock.mockResolvedValue(undefined);
    publishSyncMock.mockReset();
    closeMock.mockReset();
    astreamMock.mockClear();
  });

  it("broadcasts live and retains the event for replay", async () => {
    const account_id = "ce1bf12d-b902-4ad6-81ff-791af37dea59";
    const event = {
      type: "news.refresh" as const,
      ts: 123,
      account_id: "stale-account-id",
    };

    await publishAccountFeedEvent({ account_id, event });

    const expected = { ...event, account_id };
    expect(publishSyncMock).toHaveBeenCalledWith(
      `account.${account_id}.account-feed-live`,
      expected,
    );
    expect(publishMock).toHaveBeenCalledWith(expected);
    expect(closeMock).toHaveBeenCalledTimes(1);
  });

  it("releases the stream when replay persistence fails", async () => {
    publishMock.mockRejectedValueOnce(new Error("publish failed"));

    await expect(
      publishAccountFeedEvent({
        account_id: "ce1bf12d-b902-4ad6-81ff-791af37dea59",
        event: {
          type: "news.refresh",
          ts: 123,
          account_id: "ce1bf12d-b902-4ad6-81ff-791af37dea59",
        },
      }),
    ).rejects.toThrow("publish failed");
    expect(closeMock).toHaveBeenCalledTimes(1);
  });
});
