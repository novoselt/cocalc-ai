/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { createInterBayAccountLocalClient } from "@cocalc/conat/inter-bay/api";
import { getConfiguredBayId } from "@cocalc/server/bay-config";
import { getConfiguredClusterSeedBayId } from "@cocalc/server/cluster-config";
import { getInterBayFabricClient } from "@cocalc/server/inter-bay/fabric";
import * as localLegacyMigration from "@cocalc/server/legacy-migration";
import type {
  LegacyMigrationAdminAccountSearchOptions,
  LegacyMigrationAdminLinkedProjectsOptions,
  LegacyMigrationAdminLinkLegacyAccountOptions,
  LegacyMigrationAdminLinksOptions,
  LegacyMigrationAdminProjectSearchOptions,
  LegacyMigrationAdminUnlinkLegacyAccountOptions,
  LegacyMigrationApplyFinancialOptions,
  LegacyMigrationConfigureFinancialRenewalOptions,
  LegacyMigrationFinancialPreviewOptions,
  LegacyMigrationImportProjectsOptions,
  LegacyMigrationListProjectsOptions,
  LegacyMigrationRetryProjectRestoreOptions,
} from "@cocalc/conat/hub/api/legacy-migration";
import isAdmin from "@cocalc/server/accounts/is-admin";
import { requireDangerousSessionAuth } from "./dangerous-session-auth";

function getSeedBayId(): string {
  return getConfiguredClusterSeedBayId();
}

function isSeedBay(): boolean {
  return getConfiguredBayId() === getSeedBayId();
}

function getSeedLegacyMigrationClient(timeout?: number) {
  return createInterBayAccountLocalClient({
    client: getInterBayFabricClient(),
    dest_bay: getSeedBayId(),
    timeout,
  });
}

async function requireAdminAccount(account_id?: string): Promise<string> {
  const accountId = `${account_id ?? ""}`.trim();
  if (!accountId) {
    throw new Error("user must be signed in");
  }
  if (!(await isAdmin(accountId))) {
    throw new Error("admin privileges required");
  }
  return accountId;
}

async function requireFreshAdminAccount({
  account_id,
  browser_id,
  session_hash,
}: {
  account_id?: string;
  browser_id?: string | null;
  session_hash?: string | null;
}): Promise<string> {
  const accountId = await requireAdminAccount(account_id);
  await requireDangerousSessionAuth({
    account_id: accountId,
    browser_id,
    session_hash,
    require_second_factor: "if_enabled",
    allow_actor_impersonation: false,
  });
  return accountId;
}

export async function listProjects(opts?: LegacyMigrationListProjectsOptions) {
  return isSeedBay()
    ? await localLegacyMigration.listProjects(opts ?? {})
    : await getSeedLegacyMigrationClient().legacyMigrationListProjects(
        opts ?? {},
      );
}

export async function importProjects(
  opts: LegacyMigrationImportProjectsOptions,
) {
  return isSeedBay()
    ? await localLegacyMigration.importProjects(opts)
    : await getSeedLegacyMigrationClient(
        opts.timeout,
      ).legacyMigrationImportProjects(opts);
}

export async function retryProjectRestore(
  opts: LegacyMigrationRetryProjectRestoreOptions,
) {
  return isSeedBay()
    ? await localLegacyMigration.retryProjectRestore(opts)
    : await getSeedLegacyMigrationClient().legacyMigrationRetryProjectRestore(
        opts,
      );
}

export async function previewFinancialMigration(
  opts?: LegacyMigrationFinancialPreviewOptions,
) {
  return isSeedBay()
    ? await localLegacyMigration.previewFinancialMigration(opts)
    : await getSeedLegacyMigrationClient().legacyMigrationPreviewFinancialMigration(
        opts ?? {},
      );
}

export async function applyFinancialMigration(
  opts?: LegacyMigrationApplyFinancialOptions,
) {
  return isSeedBay()
    ? await localLegacyMigration.applyFinancialMigration(opts)
    : await getSeedLegacyMigrationClient().legacyMigrationApplyFinancialMigration(
        opts ?? {},
      );
}

export async function configureFinancialMembershipRenewal(
  opts?: LegacyMigrationConfigureFinancialRenewalOptions,
) {
  return await localLegacyMigration.configureFinancialMembershipRenewal(
    opts ?? {},
  );
}

export async function adminSearchLegacyAccounts(
  opts: LegacyMigrationAdminAccountSearchOptions,
) {
  await requireAdminAccount(opts?.account_id);
  return isSeedBay()
    ? await localLegacyMigration.adminSearchLegacyAccounts(opts)
    : await getSeedLegacyMigrationClient().legacyMigrationAdminSearchLegacyAccounts(
        opts,
      );
}

export async function adminSearchLegacyProjects(
  opts: LegacyMigrationAdminProjectSearchOptions,
) {
  await requireAdminAccount(opts?.account_id);
  return isSeedBay()
    ? await localLegacyMigration.adminSearchLegacyProjects(opts)
    : await getSeedLegacyMigrationClient().legacyMigrationAdminSearchLegacyProjects(
        opts,
      );
}

export async function adminListLegacyAccountLinks(
  opts: LegacyMigrationAdminLinksOptions,
) {
  await requireAdminAccount(opts?.account_id);
  return isSeedBay()
    ? await localLegacyMigration.adminListLegacyAccountLinks(opts)
    : await getSeedLegacyMigrationClient().legacyMigrationAdminListLegacyAccountLinks(
        opts,
      );
}

export async function adminLinkLegacyAccount(
  opts: LegacyMigrationAdminLinkLegacyAccountOptions,
) {
  await requireFreshAdminAccount({
    account_id: opts?.account_id,
    browser_id: opts?.browser_id,
    session_hash: opts?.session_hash,
  });
  return isSeedBay()
    ? await localLegacyMigration.adminLinkLegacyAccount(opts)
    : await getSeedLegacyMigrationClient().legacyMigrationAdminLinkLegacyAccount(
        opts,
      );
}

export async function adminUnlinkLegacyAccount(
  opts: LegacyMigrationAdminUnlinkLegacyAccountOptions,
) {
  await requireFreshAdminAccount({
    account_id: opts?.account_id,
    browser_id: opts?.browser_id,
    session_hash: opts?.session_hash,
  });
  return isSeedBay()
    ? await localLegacyMigration.adminUnlinkLegacyAccount(opts)
    : await getSeedLegacyMigrationClient().legacyMigrationAdminUnlinkLegacyAccount(
        opts,
      );
}

export async function adminListLinkedLegacyProjects(
  opts: LegacyMigrationAdminLinkedProjectsOptions,
) {
  await requireAdminAccount(opts?.account_id);
  return isSeedBay()
    ? await localLegacyMigration.adminListLinkedLegacyProjects(opts)
    : await getSeedLegacyMigrationClient().legacyMigrationAdminListLinkedLegacyProjects(
        opts,
      );
}
