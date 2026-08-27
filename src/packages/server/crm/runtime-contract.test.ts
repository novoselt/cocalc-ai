/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  CRM_FEATURE_FLAGS,
  CRM_SCHEMA_CONTRACT_VERSION,
  type CrmFeatureFlagSnapshot,
} from "@cocalc/util/crm";

import {
  createCrmRuntimeContract,
  getCrmServerBuildIdentity,
} from "./runtime-contract";

function disabledFeatureFlags(): CrmFeatureFlagSnapshot {
  return Object.fromEntries(
    Object.values(CRM_FEATURE_FLAGS).map((flag) => [flag, false]),
  ) as CrmFeatureFlagSnapshot;
}

describe("CRM runtime contract", () => {
  it("uses authoritative launchpad environment metadata when present", () => {
    expect(
      getCrmServerBuildIdentity(
        {
          COCALC_LAUNCHPAD_ARTIFACT_ID: "launchpad-build-1",
          COCALC_LAUNCHPAD_VERSION: "1.2.3",
          COCALC_LAUNCHPAD_GIT_COMMIT:
            "0123456789abcdef0123456789abcdef01234567",
        },
        "0.45.26",
      ),
    ).toEqual({
      source: "launchpad-environment",
      build_id: "launchpad-build-1",
      built_at: null,
      git_commit: "0123456789abcdef0123456789abcdef01234567",
      git_commit_short: "0123456789ab",
      git_dirty: null,
      git_diff_hash: null,
      package_version: "1.2.3",
      artifact_kind: "launchpad",
    });
  });

  it("represents unavailable build fields explicitly", () => {
    expect(getCrmServerBuildIdentity({}, "0.45.26")).toEqual({
      source: "package-metadata",
      build_id: null,
      built_at: null,
      git_commit: null,
      git_commit_short: null,
      git_dirty: null,
      git_diff_hash: null,
      package_version: "0.45.26",
      artifact_kind: null,
    });
  });

  it("binds the schema version, server build, and exact flag snapshot", () => {
    const featureFlags = {
      ...disabledFeatureFlags(),
      crm_visible: true,
    };
    const contract = createCrmRuntimeContract({
      env: {
        COCALC_STAR_RELEASE_ID: "star-release-1",
        COCALC_STAR_GIT_REVISION: "abcdef0123456789abcdef0123456789abcdef01",
      },
      serverPackageVersion: "0.45.26",
      featureFlags,
    });
    expect(contract.crm_schema_contract_version).toBe(
      CRM_SCHEMA_CONTRACT_VERSION,
    );
    expect(contract.server_build).toMatchObject({
      source: "star-environment",
      build_id: "star-release-1",
      git_commit_short: "abcdef012345",
      package_version: "0.45.26",
      artifact_kind: "cocalc-star",
    });
    expect(contract.feature_flags).toEqual(featureFlags);
  });
});
