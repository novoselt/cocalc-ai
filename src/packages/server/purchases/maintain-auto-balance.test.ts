/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const queryMock = jest.fn();
const getBalanceMock = jest.fn();
const getAllOpenPaymentsMock = jest.fn();
const createPaymentIntentMock = jest.fn();
const sendMock = jest.fn();

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({ query: (...args: any[]) => queryMock(...args) }),
}));

jest.mock("@cocalc/server/purchases/get-balance", () => ({
  __esModule: true,
  default: (...args: any[]) => getBalanceMock(...args),
}));

jest.mock("@cocalc/server/purchases/stripe/get-payments", () => ({
  getAllOpenPayments: (...args: any[]) => getAllOpenPaymentsMock(...args),
}));

jest.mock("@cocalc/server/purchases/stripe/create-payment-intent", () => ({
  __esModule: true,
  default: (...args: any[]) => createPaymentIntentMock(...args),
}));

jest.mock("@cocalc/server/purchases/statements/email-statement", () => ({
  getUser: jest.fn(async () => ({ name: "Test User" })),
}));

jest.mock("@cocalc/server/messages/send", () => ({
  __esModule: true,
  default: (...args: any[]) => sendMock(...args),
  support: jest.fn(async () => "Support"),
  url: jest.fn(async () => "https://example.test/settings/payments"),
}));

import { __test__ } from "./maintain-auto-balance";

const ACCOUNT_ID = "11111111-1111-4111-8111-111111111111";
const PERIODS = ["day", "week", "month"] as const;

function config(period: (typeof PERIODS)[number]) {
  return {
    trigger: 10,
    amount: 20,
    max_day: 100,
    max_week: 100,
    max_month: 100,
    period,
    enabled: true,
  };
}

describe("automatic deposit rolling limits", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getBalanceMock.mockResolvedValue(5);
    getAllOpenPaymentsMock.mockResolvedValue({ data: [] });
    createPaymentIntentMock.mockResolvedValue({});
    sendMock.mockResolvedValue(undefined);
  });

  it.each(PERIODS)(
    "allows a deposit that exactly reaches the %s limit",
    async (period) => {
      queryMock.mockResolvedValue({
        rows: [{ time: new Date(), cost: -80 }],
      });

      const result = await __test__.update({
        account_id: ACCOUNT_ID,
        auto_balance: config(period),
      });

      expect(createPaymentIntentMock).toHaveBeenCalledWith(
        expect.objectContaining({
          account_id: ACCOUNT_ID,
          allowedPaymentMethodTypes: ["card"],
          lineItems: [
            expect.objectContaining({
              amount: 20,
            }),
          ],
        }),
      );
      expect(result.status?.[period]).toBe(100);
    },
  );

  it.each(PERIODS)(
    "rejects a deposit that would exceed the %s limit",
    async (period) => {
      queryMock.mockResolvedValue({
        rows: [{ time: new Date(), cost: -81 }],
      });

      const result = await __test__.update({
        account_id: ACCOUNT_ID,
        auto_balance: config(period),
      });

      expect(createPaymentIntentMock).not.toHaveBeenCalled();
      expect(result.status).toBeUndefined();
      expect(result.reason).toContain("threshold of $100.00 would be exceeded");
    },
  );
});
