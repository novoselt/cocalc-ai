/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { shortGitCommit } from "@cocalc/util/build-identity";
import type { StarServerInfo } from "@cocalc/conat/hub/api/system";
import {
  CRM_SCHEMA_CONTRACT_VERSION,
  type CrmFeatureFlagSnapshot,
  type CrmRuntimeContract,
  type CrmServerBuildIdentity,
} from "@cocalc/util/crm";
import { getCrmFeatureFlagSnapshot } from "./feature-flags";
import { readStarServerInfo } from "@cocalc/server/star-server-info";

function optionalString(value: unknown): string | null {
  const normalized = `${value ?? ""}`.trim();
  return normalized || null;
}

function getServerPackageVersion(): string | null {
  for (const relativePath of ["../package.json", "../../package.json"]) {
    try {
      const metadata = JSON.parse(
        readFileSync(join(__dirname, relativePath), "utf8"),
      );
      if (metadata?.name === "@cocalc/server") {
        return optionalString(metadata.version);
      }
    } catch {
      // Source, compiled, and bundled layouts do not share one package path.
    }
  }
  return null;
}

export function getCrmServerBuildIdentity(
  env: Readonly<Record<string, string | undefined>> = process.env,
  serverPackageVersion: string | null = getServerPackageVersion(),
  starServerInfo?: StarServerInfo,
): CrmServerBuildIdentity {
  const launchpadBuildId = optionalString(env.COCALC_LAUNCHPAD_ARTIFACT_ID);
  const launchpadVersion = optionalString(env.COCALC_LAUNCHPAD_VERSION);
  const launchpadCommit = optionalString(env.COCALC_LAUNCHPAD_GIT_COMMIT);
  const launchpadCommitShort = optionalString(env.COCALC_LAUNCHPAD_GIT_SHORT);
  const hasLaunchpadIdentity =
    launchpadBuildId != null ||
    launchpadVersion != null ||
    launchpadCommit != null ||
    launchpadCommitShort != null;

  const starBuildId =
    optionalString(env.COCALC_STAR_RELEASE_ID) ??
    optionalString(env.STAR_RELEASE_ID);
  const starCommit = optionalString(env.COCALC_STAR_GIT_REVISION);
  const hasStarReleaseIdentity = starServerInfo?.detected === true;
  const hasStarEnvironmentIdentity = starBuildId != null || starCommit != null;

  const source = hasLaunchpadIdentity
    ? "launchpad-environment"
    : hasStarReleaseIdentity
      ? "star-release-metadata"
      : hasStarEnvironmentIdentity
        ? "star-environment"
        : "package-metadata";
  const gitCommit = hasLaunchpadIdentity
    ? launchpadCommit
    : hasStarReleaseIdentity
      ? optionalString(starServerInfo?.git_revision)
      : starCommit;

  return {
    source,
    build_id: hasLaunchpadIdentity
      ? launchpadBuildId
      : hasStarReleaseIdentity
        ? optionalString(starServerInfo?.release_id)
        : starBuildId,
    built_at: hasStarReleaseIdentity
      ? optionalString(starServerInfo?.built_at)
      : null,
    git_commit: gitCommit,
    git_commit_short:
      shortGitCommit(gitCommit) ?? shortGitCommit(launchpadCommitShort) ?? null,
    git_dirty: hasStarReleaseIdentity
      ? (starServerInfo?.git_dirty ?? null)
      : null,
    git_diff_hash: null,
    package_version:
      (hasLaunchpadIdentity ? launchpadVersion : null) ??
      optionalString(serverPackageVersion),
    artifact_kind: hasLaunchpadIdentity
      ? "launchpad"
      : hasStarReleaseIdentity || hasStarEnvironmentIdentity
        ? "cocalc-star"
        : null,
  };
}

export function createCrmRuntimeContract({
  env,
  serverPackageVersion,
  featureFlags,
  starServerInfo,
}: {
  env?: Readonly<Record<string, string | undefined>>;
  serverPackageVersion?: string | null;
  featureFlags: CrmFeatureFlagSnapshot;
  starServerInfo?: StarServerInfo;
}): CrmRuntimeContract {
  return {
    crm_schema_contract_version: CRM_SCHEMA_CONTRACT_VERSION,
    server_build: getCrmServerBuildIdentity(
      env,
      serverPackageVersion,
      starServerInfo,
    ),
    feature_flags: featureFlags,
  };
}

export async function getCrmRuntimeContract(): Promise<CrmRuntimeContract> {
  return createCrmRuntimeContract({
    featureFlags: await getCrmFeatureFlagSnapshot(),
    starServerInfo: await readStarServerInfo(),
  });
}
