/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  computeVmRegionFromSubnetwork,
  computeVmUiEnabled,
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

  it("hides production auto mode and exposes explicit canary mode", () => {
    expect(computeVmUiEnabled({ dns: "cocalc.ai" })).toBe(false);
    expect(computeVmUiEnabled({ dns: "staging.cocalc.ai" })).toBe(true);
    expect(
      computeVmUiEnabled({
        dns: "cocalc.ai",
        compute_vm_mode: "admin_canary",
      }),
    ).toBe(true);
    expect(
      computeVmUiEnabled({
        dns: "staging.cocalc.ai",
        compute_vm_mode: "disabled",
      }),
    ).toBe(false);
    expect(
      computeVmUiEnabled({
        dns: "staging.cocalc.ai",
        compute_vm_mode: "enabled",
      }),
    ).toBe(true);
    expect(
      computeVmUiEnabled({
        dns: "staging.cocalc.ai",
        compute_vm_mode: "invalid",
      }),
    ).toBe(false);
  });

  it("fails closed on production defaults", () => {
    const config = resolveComputeVmConfig({ dns: "cocalc.ai" });
    expect(config.mode).toBe("disabled");
    expect(config.staging_legacy_provider).toBe(false);
    expect(config.max_active_per_project).toBe(10);
    expect(config.max_active_total).toBe(1_000);
    expect(config.max_volumes_per_account).toBe(10);
    expect(config.max_volume_gb).toBe(10_000);
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

  it("rejects admission while emergency stop is active", () => {
    const config = resolveComputeVmConfig({
      dns: "staging.cocalc.ai",
      compute_vm_emergency_stop: "yes",
    });
    expect(config.emergency_stop).toBe(true);
    expect(() => requireComputeVmCreateAllowed(config, "account-1")).toThrow(
      "emergency stop is active",
    );
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

    expect(
      computeVmRegionFromSubnetwork(
        "projects/compute-prod/regions/us-central1/subnetworks/compute",
      ),
    ).toBe("us-central1");
    expect(
      computeVmRegionFromSubnetwork(
        "projects/compute-prod/zones/us-central1-a/subnetworks/compute",
      ),
    ).toBeUndefined();

    expect(() =>
      requireComputeVmCreateAllowed(
        resolveComputeVmConfig({
          ...base,
          compute_vm_gcp_service_account_json: credentials,
          compute_vm_gcp_subnetwork: "not-a-subnetwork-uri",
        }),
        "account-1",
      ),
    ).toThrow("subnetwork URI is invalid");

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
