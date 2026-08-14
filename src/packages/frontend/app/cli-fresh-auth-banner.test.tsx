/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { act, render, screen, waitFor } from "@testing-library/react";
import { EventEmitter } from "events";

const postAuthApi = jest.fn();
const getSharedAccountDStream = jest.fn();

jest.mock("@cocalc/frontend/auth/api", () => ({
  postAuthApi: (...args: any[]) => postAuthApi(...args),
}));

jest.mock("@cocalc/frontend/conat/account-dstream", () => ({
  getSharedAccountDStream: (...args: any[]) => getSharedAccountDStream(...args),
}));

import { CliFreshAuthBannerForAccount } from "./cli-fresh-auth-banner";

const challenge = {
  challenge_id: "challenge-1",
  kind: "elevate",
  requested_duration: "extended",
  elevated_login: false,
  approval_url: "https://staging.cocalc.ai/auth/cli-elevate/challenge-1",
  expires_at: "2099-08-14T20:00:00.000Z",
  created_at: "2099-08-14T12:00:00.000Z",
};

describe("CliFreshAuthBannerForAccount", () => {
  let feed: EventEmitter;

  beforeEach(() => {
    postAuthApi.mockReset();
    getSharedAccountDStream.mockReset();
    feed = new EventEmitter();
    getSharedAccountDStream.mockResolvedValue(feed);
  });

  it("shows an account-wide link for a pending CLI request", async () => {
    postAuthApi.mockResolvedValue({ challenges: [challenge] });

    const { unmount } = render(
      <CliFreshAuthBannerForAccount accountId="account-1" />,
    );

    const link = await screen.findByRole("link", {
      name: "Review CLI fresh-auth request",
    });
    expect(link.getAttribute("href")).toBe(challenge.approval_url);
    expect(link.getAttribute("target")).toBe("_blank");
    expect(screen.getByText(/up to 8 hours/)).not.toBeNull();
    expect(postAuthApi).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("appears and clears through account-feed events without polling", async () => {
    postAuthApi.mockResolvedValue({ challenges: [] });

    const { unmount } = render(
      <CliFreshAuthBannerForAccount accountId="account-1" />,
    );
    await waitFor(() => expect(postAuthApi).toHaveBeenCalledTimes(1));

    act(() => {
      feed.emit("change", {
        type: "cli.auth.changed",
        account_id: "account-1",
        ts: Date.now(),
        challenge_id: challenge.challenge_id,
        pending: true,
        challenge,
      });
    });
    expect(
      await screen.findByRole("link", {
        name: "Review CLI fresh-auth request",
      }),
    ).not.toBeNull();

    act(() => {
      feed.emit("change", {
        type: "cli.auth.changed",
        account_id: "account-1",
        ts: Date.now(),
        challenge_id: challenge.challenge_id,
        pending: false,
      });
    });
    await waitFor(() =>
      expect(
        screen.queryByRole("link", {
          name: "Review CLI fresh-auth request",
        }),
      ).toBeNull(),
    );
    expect(postAuthApi).toHaveBeenCalledTimes(1);
    unmount();
  });
});
