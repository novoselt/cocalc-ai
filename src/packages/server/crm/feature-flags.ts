/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { getServerSettings } from "@cocalc/database/settings/server-settings";

export const CRM_FLAGS = {
  visible: "crm_visible",
  mutate: "crm_mutations_enabled",
  pipeline: "crm_pipeline_mutations_enabled",
  zendesk: "crm_zendesk_linking_enabled",
  commercial: "crm_commercial_integration_enabled",
  metrics: "crm_metric_projections_enabled",
  export: "crm_exports_enabled",
  backfill: "crm_backfill_enabled",
  outreach: "crm_outreach_enabled",
  outreachMutate: "crm_outreach_mutations_enabled",
  outreachDelivery: "crm_outreach_delivery_enabled",
  outreachWebhook: "crm_outreach_webhook_enabled",
} as const;

export type CrmCapability = keyof typeof CRM_FLAGS;

const READ_ACTIONS = new Set([
  "listOrganizations",
  "searchOrganizations",
  "getSupportContext",
  "getOrganization",
  "getCustomerTimeline",
  "listPeople",
  "searchPeople",
  "getPerson",
  "listOpportunities",
  "getOpportunity",
  "listTasks",
  "getTask",
  "getCustomerMetrics",
  "getDiagnostics",
  "getDailyDigest",
  "listOutreachTemplates",
  "getOutreachTemplate",
  "listOutreachBatches",
  "getOutreachBatch",
  "listOutreachDeliveries",
  "getOutreachDelivery",
  "listOutreachProviderOperations",
  "previewOutreachBatch",
  "listContactSuppressions",
  "getOutreachLimits",
  "getOutreachDiagnostics",
  "listOutreachEngagementEvents",
  "listOutreachFollowups",
  "previewOutreachFollowup",
]);

const OUTREACH_READ_ACTIONS = new Set([
  "listOutreachTemplates",
  "getOutreachTemplate",
  "listOutreachBatches",
  "getOutreachBatch",
  "listOutreachDeliveries",
  "getOutreachDelivery",
  "listOutreachProviderOperations",
  "previewOutreachBatch",
  "listContactSuppressions",
  "getOutreachLimits",
  "getOutreachDiagnostics",
  "listOutreachEngagementEvents",
  "listOutreachFollowups",
  "previewOutreachFollowup",
]);

export function crmActionCapabilities(
  action: string,
  request: Record<string, unknown> = {},
): CrmCapability[] {
  if (action === "exportData") return ["visible", "export"];
  if (action === "backfill") return ["visible", "backfill"];
  if (action === "getCustomerMetrics") return ["visible", "metrics"];
  if (OUTREACH_READ_ACTIONS.has(action)) {
    return ["visible", "outreach"];
  }
  if (READ_ACTIONS.has(action)) return ["visible"];
  if (
    [
      "createOutreachTemplate",
      "transitionOutreachTemplate",
      "createOutreachBatch",
      "updateOutreachBatch",
      "addOutreachRecipient",
      "removeOutreachRecipient",
      "transitionOutreachBatch",
      "mutateOutreachDelivery",
      "mutateContactSuppression",
    ].includes(action)
  ) {
    return ["visible", "mutate", "outreach", "outreachMutate"];
  }
  if (["sendOutreachFollowup", "syncOutreachDelivery"].includes(action)) {
    return [
      "visible",
      "mutate",
      "zendesk",
      "outreach",
      "outreachMutate",
      "outreachDelivery",
    ];
  }
  if (
    [
      "createOpportunity",
      "updateOpportunity",
      "transitionOpportunity",
      "createTask",
      "updateTask",
      "transitionTask",
    ].includes(action)
  ) {
    return ["visible", "mutate", "pipeline"];
  }
  if (action === "createCommercialOrderFromOpportunity") {
    return ["visible", "mutate", "pipeline", "commercial"];
  }
  if (action === "mutateExternalReference") {
    const capability =
      request.provider === "zendesk" ? "zendesk" : "commercial";
    return ["visible", "mutate", capability];
  }
  return ["visible", "mutate"];
}

export async function assertCrmCapability(
  capability: CrmCapability,
): Promise<void> {
  const settings = await getServerSettings();
  if (settings[CRM_FLAGS[capability]] === true) return;
  throw Object.assign(
    Error(`CRM capability '${capability}' is disabled by site settings`),
    { code: 503 },
  );
}

export async function getCrmCapabilities(): Promise<
  Record<CrmCapability, boolean>
> {
  const settings = await getServerSettings();
  return Object.fromEntries(
    Object.entries(CRM_FLAGS).map(([capability, setting]) => [
      capability,
      settings[setting] === true,
    ]),
  ) as Record<CrmCapability, boolean>;
}
