/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const withAccountRehomeWriteFenceMock = jest.fn();
const publishAccountRowFeedEventsBestEffortMock = jest.fn();

jest.mock("@cocalc/server/accounts/rehome-fence", () => ({
  withAccountRehomeWriteFence: (...args: any[]) =>
    withAccountRehomeWriteFenceMock(...args),
}));

jest.mock("@cocalc/server/account/account-row-feed", () => ({
  publishAccountRowFeedEventsBestEffort: (...args: any[]) =>
    publishAccountRowFeedEventsBestEffortMock(...args),
}));

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const CONFIG = {
  trigger: 10,
  amount: 20,
  max_day: 200,
  max_week: 1000,
  max_month: 2500,
  period: "week" as const,
  enabled: true,
};

describe("automatic deposit account settings", () => {
  beforeEach(() => {
    jest.resetModules();
    withAccountRehomeWriteFenceMock.mockReset();
    publishAccountRowFeedEventsBestEffortMock.mockReset();
  });

  it("stores only user-configurable fields behind the account write fence", async () => {
    const query = jest.fn(async (_sql: string, params: any[]) => ({
      rows: [{ auto_balance: JSON.parse(params[0]) }],
    }));
    withAccountRehomeWriteFenceMock.mockImplementation(async ({ fn }) => {
      return await fn({ query });
    });

    const { setAutoBalance } = await import("./auto-balance");
    const result = await setAutoBalance({
      account_id: ACCOUNT_ID,
      auto_balance: {
        ...CONFIG,
        reason: "spoofed maintenance result",
        time: 123,
        status: { day: 20, week: 20, month: 20 },
      } as any,
    });

    expect(result).toEqual(CONFIG);
    expect(withAccountRehomeWriteFenceMock).toHaveBeenCalledWith({
      account_id: ACCOUNT_ID,
      action: "configure automatic deposits",
      fn: expect.any(Function),
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE accounts"),
      [JSON.stringify(CONFIG), ACCOUNT_ID],
    );
    expect(publishAccountRowFeedEventsBestEffortMock).toHaveBeenCalledWith({
      account_id: ACCOUNT_ID,
      patch: { auto_balance: CONFIG },
    });
  });

  it("rejects invalid settings before opening the account write fence", async () => {
    const { setAutoBalance } = await import("./auto-balance");

    await expect(
      setAutoBalance({
        account_id: ACCOUNT_ID,
        auto_balance: { ...CONFIG, max_week: 50_000 },
      }),
    ).rejects.toThrow("max_week must be at most 5000");

    expect(withAccountRehomeWriteFenceMock).not.toHaveBeenCalled();
  });
});
