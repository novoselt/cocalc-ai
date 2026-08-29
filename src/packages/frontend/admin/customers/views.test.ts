/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { CrmOrganizationSummary } from "@cocalc/util/crm";
import {
  customerMatchesView,
  emptyViewDescription,
  queueFilterRequest,
  viewDescription,
  viewRequest,
} from "./views";

function customer(
  openOpportunityKinds: CrmOrganizationSummary["open_opportunity_kinds"],
): CrmOrganizationSummary {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    customer_number: "CRM-2026-000001",
    display_name: "Example University",
    aliases: [],
    organization_type: "university",
    lifecycle_stage: "prospect",
    status: "active",
    created_by_account_id: "00000000-0000-4000-8000-000000000002",
    updated_by_account_id: "00000000-0000-4000-8000-000000000002",
    created_at: "2026-08-27T00:00:00.000Z",
    updated_at: "2026-08-27T00:00:00.000Z",
    version: 1,
    verified_domains: ["example.edu"],
    primary_contacts: [],
    open_opportunity_count: openOpportunityKinds.length,
    open_opportunity_kinds: openOpportunityKinds,
    outstanding_receivables: "0",
  };
}

describe("CRM customer queue views", () => {
  it("uses open opportunity kinds for pipeline views", () => {
    expect(viewRequest("pipeline")).toMatchObject({
      opportunity_kinds: expect.arrayContaining([
        "adoption_pilot",
        "new_site_license",
        "renewal",
        "expansion",
      ]),
    });
    expect(viewRequest("pilots")).toEqual({
      opportunity_kinds: ["adoption_pilot"],
    });
    expect(viewRequest("renewals")).toEqual({
      opportunity_kinds: ["renewal"],
    });
  });

  it("does not confuse a prospect lifecycle with an adoption pilot", () => {
    const newLicense = customer(["new_site_license"]);
    const pilot = customer(["adoption_pilot"]);

    expect(customerMatchesView(newLicense, "prospects")).toBe(true);
    expect(customerMatchesView(newLicense, "pipeline")).toBe(true);
    expect(customerMatchesView(newLicense, "pilots")).toBe(false);
    expect(customerMatchesView(pilot, "pilots")).toBe(true);
  });

  it("explains pipeline filters and empty states", () => {
    expect(viewDescription("pilots")).toContain(
      "open Adoption pilot opportunity",
    );
    expect(emptyViewDescription("pilots", false)).toBe(
      "There are no open Adoption pilot opportunities.",
    );
    expect(emptyViewDescription("pilots", true)).toBe(
      "No search results match this view.",
    );
  });

  it("combines a saved view with a relationship-owner filter", () => {
    const owner = "00000000-0000-4000-8000-000000000003";
    expect(queueFilterRequest("pilots", owner)).toEqual({
      opportunity_kinds: ["adoption_pilot"],
      owner_account_id: owner,
    });
    expect(queueFilterRequest("active")).toEqual({ statuses: ["active"] });
    expect(queueFilterRequest("unassigned", owner)).toEqual({
      unassigned: true,
    });
  });
});
