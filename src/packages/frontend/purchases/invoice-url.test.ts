/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const getInvoiceUrl = jest.fn();

jest.mock("./api", () => ({
  getInvoiceUrl: (...args: any[]) => getInvoiceUrl(...args),
}));

import { getInvoiceUrlOrNull } from "./invoice-url";

describe("getInvoiceUrlOrNull", () => {
  beforeEach(() => {
    getInvoiceUrl.mockReset();
  });

  it("returns a receipt URL", async () => {
    getInvoiceUrl.mockResolvedValue("https://stripe.example/receipt");

    await expect(getInvoiceUrlOrNull("in_123")).resolves.toBe(
      "https://stripe.example/receipt",
    );
  });

  it("contains missing legacy invoice failures", async () => {
    getInvoiceUrl.mockRejectedValue(
      new Error("No such invoice: 'legacy-migration-credit:account-1'"),
    );

    await expect(
      getInvoiceUrlOrNull("legacy-migration-credit:account-1"),
    ).resolves.toBeNull();
  });
});
