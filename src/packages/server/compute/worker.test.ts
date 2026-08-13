/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  computeWorkFailureState,
  computeRuntimeMetadata,
  computePostStopTransition,
  isSpotCapacityError,
  managedVmReadinessCommand,
  providerComputeInstanceIsExpected,
  RetryableComputeWorkError,
  runtimeIdentityChanged,
  volumeAttachedToVm,
} from "./worker";
import { effectiveComputeVolumeSizeGb } from "./volume-size";

describe("managed compute volume sizes", () => {
  it("keeps requested and effective Nebius sizes distinct", () => {
    expect(effectiveComputeVolumeSizeGb("nebius", 50)).toBe(93);
    expect(effectiveComputeVolumeSizeGb("nebius", 93)).toBe(93);
    expect(effectiveComputeVolumeSizeGb("nebius", 94)).toBe(186);
    expect(effectiveComputeVolumeSizeGb("gcp", 50)).toBe(50);
  });
});

describe("managed VM readiness command", () => {
  it("preserves the full remote shell expression as one quoted command", () => {
    const command = managedVmReadinessCommand(
      { bootstrap_revision: 2 } as any,
      "/dev/disk/by-id/google-home-disk",
    );

    expect(command).toMatch(/^bash -lc '/);
    expect(command).toContain('test "$(id -gn)" = user');
    expect(command).toContain("! id ubuntu >/dev/null 2>&1");
    expect(command).toContain("readlink -f /dev/disk/by-id/google-home-disk");
    expect(command).toContain("bootstrap-ready");
    expect(command).toMatch(/'$/);
  });
});

describe("compute VM work failure state", () => {
  it("keeps scheduled Spot retries in recovering state", () => {
    const retry = new RetryableComputeWorkError(
      "Spot capacity is unavailable",
      new Date("2026-08-04T00:00:00.000Z"),
    );

    expect(computeWorkFailureState(retry)).toBe("recovering");
    expect(retry.retryAt.toISOString()).toBe("2026-08-04T00:00:00.000Z");
  });

  it("matches Nebius inventory by opaque ID or stable provider name", () => {
    const vm = {
      provider: "nebius",
      provider_instance_id: "opaque-nebius-id",
      metadata: { provider_instance_name: "cocalc-vm-stable" },
    } as any;
    expect(
      providerComputeInstanceIsExpected(
        {
          provider: "nebius",
          instance_id: "opaque-nebius-id",
          name: "cocalc-vm-stable",
        },
        [vm],
      ),
    ).toBe(true);
    expect(
      providerComputeInstanceIsExpected(
        {
          provider: "nebius",
          instance_id: "different-opaque-id",
          name: "cocalc-vm-stable",
        },
        [vm],
      ),
    ).toBe(true);
    expect(
      providerComputeInstanceIsExpected(
        {
          provider: "nebius",
          instance_id: "unknown",
          name: "cocalc-vm-unknown",
        },
        [vm],
      ),
    ).toBe(false);
  });

  it("matches an attached volume against the provider's opaque VM ID", () => {
    const vm = { provider_instance_id: "opaque-nebius-id" } as any;
    expect(
      volumeAttachedToVm(
        [
          "compute/v1/disks/disk-1/users/instances/opaque-nebius-id",
          "compute/v1/disks/disk-1/users/instances/another-instance",
        ],
        vm,
      ),
    ).toBe(true);
    expect(
      volumeAttachedToVm(
        ["compute/v1/disks/disk-1/users/instances/provider-name-only"],
        vm,
      ),
    ).toBe(false);
  });

  it("classifies terminal work errors as failed", () => {
    expect(
      computeWorkFailureState(new Error("invalid provider response")),
    ).toBe("failed");
  });

  it("recognizes provider capacity errors as retryable Spot failures", () => {
    expect(
      isSpotCapacityError(
        new Error("ZONE_RESOURCE_POOL_EXHAUSTED_WITH_DETAILS: unavailable"),
      ),
    ).toBe(true);
    expect(isSpotCapacityError(new Error("invalid machine type"))).toBe(false);
  });

  it("preserves and refreshes provider network identity", () => {
    expect(
      computeRuntimeMetadata(
        {
          private_ip: "10.0.0.1",
          internal_hostname: "old.internal",
          boot_disk_name: "disk-1",
        },
        {
          private_ip: "10.0.0.2",
          internal_hostname: "new.internal",
          metadata: { machine_type: "e2-standard-2" },
        },
      ),
    ).toEqual({
      private_ip: "10.0.0.2",
      internal_hostname: "new.internal",
      boot_disk_name: "disk-1",
      machine_type: "e2-standard-2",
    });
  });

  it("converges the GCP numeric instance identity used for egress metering", () => {
    expect(
      runtimeIdentityChanged(
        { private_ip: "10.0.0.2" },
        {
          private_ip: "10.0.0.2",
          metadata: { gcp_instance_id: "1234567890" },
        },
      ),
    ).toBe(true);
    expect(
      runtimeIdentityChanged(
        { private_ip: "10.0.0.2", gcp_instance_id: "1234567890" },
        {
          private_ip: "10.0.0.2",
          metadata: { gcp_instance_id: "1234567890" },
        },
      ),
    ).toBe(false);
  });

  it("honors newer durable intent after a provider stop completes", () => {
    expect(computePostStopTransition("stopped")).toEqual({
      state: "stopped",
      action: undefined,
    });
    expect(computePostStopTransition("running")).toEqual({
      state: "starting",
      action: "start",
    });
    expect(computePostStopTransition("deleted")).toEqual({
      state: "deleting",
      action: "delete",
    });
  });
});
