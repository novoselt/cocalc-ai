/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { crmActionCapabilities } from "./feature-flags";

describe("CRM rollout capabilities", () => {
  it("keeps reads, pipeline, external systems, and backfill independently gated", () => {
    expect(crmActionCapabilities("listOrganizations")).toEqual(["visible"]);
    expect(crmActionCapabilities("getCustomerMetrics")).toEqual([
      "visible",
      "metrics",
    ]);
    expect(crmActionCapabilities("createTask")).toEqual([
      "visible",
      "mutate",
      "pipeline",
    ]);
    expect(
      crmActionCapabilities("mutateExternalReference", {
        provider: "zendesk",
      }),
    ).toEqual(["visible", "mutate", "zendesk"]);
    expect(
      crmActionCapabilities("mutateExternalReference", {
        provider: "stripe",
      }),
    ).toEqual(["visible", "mutate", "commercial"]);
    expect(crmActionCapabilities("backfill")).toEqual(["visible", "backfill"]);
    expect(crmActionCapabilities("listContactSuppressions")).toEqual([
      "visible",
      "outreach",
    ]);
    expect(crmActionCapabilities("createOutreachBatch")).toEqual([
      "visible",
      "mutate",
      "outreach",
      "outreachMutate",
    ]);
    expect(crmActionCapabilities("sendOutreachFollowup")).toEqual([
      "visible",
      "mutate",
      "zendesk",
      "outreach",
      "outreachMutate",
      "outreachDelivery",
    ]);
  });
});
