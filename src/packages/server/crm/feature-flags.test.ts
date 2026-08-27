/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  CRM_FLAGS,
  crmActionCapabilities,
  crmFeatureFlagSnapshot,
} from "./feature-flags";

describe("CRM rollout capabilities", () => {
  it("reports every effective feature flag by its site-setting name", () => {
    const snapshot = crmFeatureFlagSnapshot({
      crm_visible: true,
      crm_backfill_enabled: "yes",
      crm_outreach_read_receipts_enabled: true,
    });
    expect(Object.keys(snapshot)).toEqual(Object.values(CRM_FLAGS));
    expect(snapshot).toMatchObject({
      crm_visible: true,
      crm_backfill_enabled: false,
      crm_outreach_read_receipts_enabled: true,
    });
  });

  it("keeps reads, pipeline, external systems, and backfill independently gated", () => {
    expect(crmActionCapabilities("listOrganizations")).toEqual(["visible"]);
    expect(crmActionCapabilities("listExternalReferences")).toEqual([
      "visible",
    ]);
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
    expect(
      crmActionCapabilities("mutateExternalReference", {
        provider: "cocalc",
        object_kind: "person",
      }),
    ).toEqual(["visible", "mutate"]);
    expect(
      crmActionCapabilities("mutateExternalReference", {
        provider: "cocalc",
        object_kind: "organization",
      }),
    ).toEqual(["visible", "mutate"]);
    expect(
      crmActionCapabilities("mutateExternalReference", {
        provider: "cocalc",
        object_kind: "commercial_order",
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
