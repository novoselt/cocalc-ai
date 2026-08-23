/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { COMMERCIAL_ACTION_CAPABILITIES } from "./feature-flags";

describe("commercial receivables action capabilities", () => {
  it("classifies every public seed action except the internal Stripe webhook", () => {
    expect(Object.keys(COMMERCIAL_ACTION_CAPABILITIES).sort()).toEqual(
      [
        "addNote",
        "approve",
        "assign",
        "backfill",
        "cancel",
        "create",
        "createInvoiceDraft",
        "diagnostics",
        "endFulfillment",
        "events",
        "fulfillmentPreview",
        "get",
        "invoicePreview",
        "issueManualInvoice",
        "linkExistingInvoice",
        "list",
        "provision",
        "reconcileInvoice",
        "reconcilePreview",
        "recordManualPayment",
        "revise",
        "retryStripeEvent",
        "sendInvoice",
        "update",
        "voidInvoice",
      ].sort(),
    );
  });

  it("routes provider-aware voids without assuming Stripe", () => {
    expect(COMMERCIAL_ACTION_CAPABILITIES.voidInvoice).toBe("visible");
    expect(COMMERCIAL_ACTION_CAPABILITIES.issueManualInvoice).toBe(
      "manualSettlement",
    );
    expect(COMMERCIAL_ACTION_CAPABILITIES.revise).toBe("mutate");
  });
});
