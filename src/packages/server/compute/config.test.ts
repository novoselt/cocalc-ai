/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  requireComputeVmCreateAllowed,
  resolveComputeVmConfig,
} from "./config";

describe("managed compute VM configuration", () => {
  const originalEnvironment = process.env.COCALC_COMPUTE_VM_ENVIRONMENT;

  beforeEach(() => {
    delete process.env.COCALC_COMPUTE_VM_ENVIRONMENT;
  });

  afterAll(() => {
    if (originalEnvironment == null) {
      delete process.env.COCALC_COMPUTE_VM_ENVIRONMENT;
    } else {
      process.env.COCALC_COMPUTE_VM_ENVIRONMENT = originalEnvironment;
    }
  });

  it("fails closed on production defaults", () => {
    const config = resolveComputeVmConfig({ dns: "cocalc.ai" });
    expect(config.mode).toBe("disabled");
    expect(config.staging_legacy_provider).toBe(false);
    expect(() => requireComputeVmCreateAllowed(config, "account-1")).toThrow(
      "creation is disabled",
    );
  });

  it("retains the explicit staging admin checkpoint", () => {
    const config = resolveComputeVmConfig({ dns: "staging.cocalc.ai" });
    expect(config.mode).toBe("admin_canary");
    expect(config.staging_legacy_provider).toBe(true);
    expect(() =>
      requireComputeVmCreateAllowed(config, "account-1"),
    ).not.toThrow();
  });

  it("requires an allowlisted account for an explicit canary", () => {
    const config = resolveComputeVmConfig({
      dns: "staging.cocalc.ai",
      compute_vm_mode: "admin_canary",
      compute_vm_admin_allowlist: "account-1, account-2",
    });
    expect(config.staging_legacy_provider).toBe(false);
    expect(() =>
      requireComputeVmCreateAllowed(config, "account-1"),
    ).not.toThrow();
    expect(() => requireComputeVmCreateAllowed(config, "account-3")).toThrow(
      "not allowlisted",
    );
  });

  it("requires isolated credentials and a subnetwork in production", () => {
    const base = {
      dns: "cocalc.ai",
      compute_vm_mode: "admin_canary",
      compute_vm_admin_allowlist: "account-1",
    };
    expect(() =>
      requireComputeVmCreateAllowed(resolveComputeVmConfig(base), "account-1"),
    ).toThrow("credentials are not configured");

    const credentials = JSON.stringify({
      project_id: "compute-prod",
      client_email: "compute@example.invalid",
    });
    expect(() =>
      requireComputeVmCreateAllowed(
        resolveComputeVmConfig({
          ...base,
          compute_vm_gcp_service_account_json: credentials,
        }),
        "account-1",
      ),
    ).toThrow("subnetwork is not configured");

    expect(() =>
      requireComputeVmCreateAllowed(
        resolveComputeVmConfig({
          ...base,
          compute_vm_gcp_service_account_json: credentials,
          compute_vm_gcp_subnetwork:
            "projects/compute-prod/regions/us-central1/subnetworks/compute",
        }),
        "account-1",
      ),
    ).not.toThrow();

    expect(() =>
      requireComputeVmCreateAllowed(
        resolveComputeVmConfig({
          ...base,
          compute_vm_gcp_service_account_json: credentials,
          compute_vm_gcp_subnetwork:
            "projects/wrong-project/regions/us-central1/subnetworks/compute",
        }),
        "account-1",
      ),
    ).toThrow("must belong to the dedicated credential project");
  });
});
