/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  assertInvoiceTermsSnapshot,
  assertWorkflowTransition,
  invoiceCollectionState,
  normalizeCreateRequest,
  normalizeCurrency,
  normalizeMoney,
  normalizeNextAction,
  requireExpectedVersion,
} from "./state";

describe("commercial order state", () => {
  it("validates customer-visible invoice terms without payment data", () => {
    expect(() =>
      assertInvoiceTermsSnapshot({
        invoice: {
          memo: "Adoption pilot through June 2027",
          billing_address: {
            line1: "1 University Way",
            city: "Seattle",
            state: "WA",
            postal_code: "98101",
            country: "US",
          },
        },
      }),
    ).not.toThrow();
    expect(() =>
      assertInvoiceTermsSnapshot({
        invoice: { billing_address: { card_number: "4242" } },
      }),
    ).toThrow("not supported");
    expect(() =>
      assertInvoiceTermsSnapshot({
        invoice: { billing_address: { country: "USA" } },
      }),
    ).toThrow("two-letter");
  });
  it("uses exact cents and validates line-item totals", () => {
    expect(normalizeMoney("3900", "amount")).toBe("3900.0000000000");
    expect(() => normalizeMoney("1.001", "amount")).toThrow(
      "no more than two decimal places",
    );
    const normalized = normalizeCreateRequest({
      reason: "accepted pilot",
      organization_name: "Example University",
      agreed_subtotal: "3900.00",
      next_action: "Confirm billing details",
      next_action_due_at: "2026-09-01T00:00:00.000Z",
      items: [
        {
          description: "Campus adoption pilot",
          quantity: "1",
          unit_amount: "3900",
          subtotal: "3900",
          product_kind: "site_license",
        },
      ],
      contacts: [
        {
          role: "billing",
          name_snapshot: "Accounts Payable",
          email_snapshot: "PAYABLE@EXAMPLE.EDU",
        },
      ],
    });
    expect(normalized.agreed_subtotal).toBe("3900.0000000000");
    expect(normalized.contacts[0].email_snapshot).toBe("payable@example.edu");
  });

  it("rejects illegal workflow and stale optimistic versions", () => {
    expect(() => assertWorkflowTransition("complete", "draft")).toThrow(
      "invalid commercial workflow transition",
    );
    expect(() => requireExpectedVersion(4, 3)).toThrow("current version is 4");
  });

  it("accepts only standard receivables next actions", () => {
    expect(normalizeNextAction("Collect payment")).toBe("Collect payment");
    expect(() => normalizeNextAction("Call Alice about the PO")).toThrow(
      "next_action is invalid",
    );
  });

  it("enforces USD-only commercial orders for the initial release", () => {
    expect(normalizeCurrency("USD")).toBe("usd");
    expect(() => normalizeCurrency("eur")).toThrow("support USD only");
  });

  it("derives paid, partial, overdue, and open collection states", () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    const past = new Date(Date.now() - 60_000).toISOString();
    expect(
      invoiceCollectionState({
        status: "paid",
        amount_due: "0",
        amount_paid: "100",
        due_at: past,
      }),
    ).toBe("paid");
    expect(
      invoiceCollectionState({
        status: "open",
        amount_due: "50",
        amount_paid: "50",
        due_at: future,
      }),
    ).toBe("partially_paid");
    expect(
      invoiceCollectionState({
        status: "open",
        amount_due: "100",
        amount_paid: "0",
        due_at: past,
      }),
    ).toBe("overdue");
    expect(
      invoiceCollectionState({
        status: "open",
        amount_due: "100",
        amount_paid: "0",
        due_at: future,
      }),
    ).toBe("open");
  });
});
