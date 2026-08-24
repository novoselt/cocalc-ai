/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  addActivity,
  archiveOrganization,
  backfill,
  createOpportunity,
  createOrderFromOpportunity,
  createOrganization,
  createPerson,
  createTask,
  exportData,
  getCustomerMetrics,
  getDailyDigest,
  getDiagnostics,
  getOpportunity,
  getOrganization,
  getPerson,
  getSupportContext,
  getTask,
  getTimeline,
  listOpportunities,
  listOrganizations,
  listPeople,
  listTasks,
  mergeOrganizations,
  mutateDomain,
  mutateExternalReference,
  mutateOrganizationPerson,
  mutatePersonAccount,
  mutatePersonEmail,
  searchOrganizations,
  transitionOpportunity,
  transitionTask,
  updateOpportunity,
  updateOrganization,
  updatePerson,
  updateTask,
} from "./store";

export interface CrmSeedRequest {
  action: string;
  actor_account_id: string;
  payload: Record<string, unknown>;
}

export async function dispatchCrmSeedRequest(
  request: CrmSeedRequest,
): Promise<unknown> {
  const opts = {
    ...request.payload,
    account_id: request.actor_account_id,
    browser_id: undefined,
    session_hash: undefined,
  } as any;
  switch (request.action) {
    case "listOrganizations":
      return await listOrganizations(opts);
    case "searchOrganizations":
      return await searchOrganizations(opts);
    case "getSupportContext":
      return await getSupportContext(opts);
    case "getOrganization":
      return await getOrganization(opts);
    case "getCustomerTimeline":
      return await getTimeline(opts);
    case "listPeople":
    case "searchPeople":
      return await listPeople(opts);
    case "getPerson":
      return await getPerson(opts);
    case "listOpportunities":
      return await listOpportunities(opts);
    case "getOpportunity":
      return await getOpportunity(opts);
    case "listTasks":
      return await listTasks(opts);
    case "getTask":
      return await getTask(opts);
    case "getCustomerMetrics":
      return await getCustomerMetrics(opts);
    case "getDiagnostics":
      return await getDiagnostics(opts);
    case "getDailyDigest":
      return await getDailyDigest(opts);
    case "exportData":
      return await exportData(opts);
    case "createOrganization":
      return await createOrganization(opts);
    case "updateOrganization":
      return await updateOrganization(opts);
    case "archiveOrganization":
      return await archiveOrganization(opts);
    case "mergeOrganizations":
      return await mergeOrganizations(opts);
    case "mutateDomain":
      return await mutateDomain(opts);
    case "createPerson":
      return await createPerson(opts);
    case "updatePerson":
      return await updatePerson(opts);
    case "mutatePersonEmail":
      return await mutatePersonEmail(opts);
    case "mutatePersonAccount":
      return await mutatePersonAccount(opts);
    case "mutateOrganizationPerson":
      return await mutateOrganizationPerson(opts);
    case "createOpportunity":
      return await createOpportunity(opts);
    case "updateOpportunity":
      return await updateOpportunity(opts);
    case "transitionOpportunity":
      return await transitionOpportunity(opts);
    case "createTask":
      return await createTask(opts);
    case "updateTask":
      return await updateTask(opts);
    case "transitionTask":
      return await transitionTask(opts);
    case "addActivity":
      return await addActivity(opts);
    case "mutateExternalReference":
      return await mutateExternalReference(opts);
    case "createCommercialOrderFromOpportunity":
      return await createOrderFromOpportunity(opts);
    case "backfill":
      return await backfill(opts);
    default:
      throw Error(`unsupported CRM seed action '${request.action}'`);
  }
}
