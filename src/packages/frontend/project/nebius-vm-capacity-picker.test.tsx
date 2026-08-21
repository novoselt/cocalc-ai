/** @jest-environment jsdom */

import type { HostCatalog } from "@cocalc/conat/hub/api/hosts";
import { fireEvent, render, screen } from "@testing-library/react";
import { NebiusVmCapacityPicker } from "./nebius-vm-capacity-picker";

const catalog: HostCatalog = {
  provider_capabilities: {},
  entries: [
    {
      kind: "regions",
      scope: "global",
      payload: [{ name: "eu-north1" }, { name: "us-central1" }],
    },
    {
      kind: "instance_types",
      scope: "global",
      payload: [
        {
          name: "1gpu-24vcpu-218gb",
          platform: "gpu-rtx6000",
          platform_label: "NVIDIA RTX PRO 6000",
          gpu_label: "NVIDIA RTX PRO 6000",
          allowed_for_preemptibles: true,
          regions: ["eu-north1", "us-central1"],
          vcpus: 24,
          memory_gib: 218,
          gpus: 1,
        },
      ],
    },
    {
      kind: "capacity_advice",
      scope: "global",
      payload: [
        {
          region: "us-central1",
          fabric: "fabric-us",
          platform: "gpu-rtx6000",
          machine_type: "1gpu-24vcpu-218gb",
          spot: {
            available: 28,
            limit: 32,
            availability_level: "high",
            data_state: "fresh",
          },
        },
        {
          region: "eu-north1",
          fabric: "fabric-eu",
          platform: "gpu-rtx6000",
          machine_type: "1gpu-24vcpu-218gb",
          spot: {
            available: 3,
            limit: 8,
            availability_level: "medium",
            data_state: "fresh",
          },
        },
      ],
    },
  ],
};

describe("NebiusVmCapacityPicker", () => {
  it("shows unique all-region choices and exposes them to keyboard users", () => {
    const onSelect = jest.fn();
    render(
      <NebiusVmCapacityPicker
        catalog={catalog}
        selection={{
          pricing_model: "spot",
          region: "us-central1",
          machine_type: "1gpu-24vcpu-218gb",
          provider_platform: "gpu-rtx6000",
        }}
        onPricingModelChange={jest.fn()}
        onSelect={onSelect}
      />,
    );

    expect(screen.getByRole("radio", { name: "CPU" })).toBeDisabled();
    const usChoice = screen.getByRole("radio", {
      name: /NVIDIA RTX PRO 6000.*us-central1/i,
    });
    const euChoice = screen.getByRole("radio", {
      name: /NVIDIA RTX PRO 6000.*eu-north1/i,
    });
    usChoice.focus();
    expect(usChoice).toHaveFocus();

    fireEvent.click(euChoice);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "eu-north1\u0000gpu-rtx6000\u00001gpu-24vcpu-218gb",
        region: "eu-north1",
      }),
    );
  });

  it("reports pricing-model changes through a named radio control", () => {
    const onPricingModelChange = jest.fn();
    render(
      <NebiusVmCapacityPicker
        catalog={catalog}
        selection={{
          pricing_model: "spot",
          region: "us-central1",
          machine_type: "1gpu-24vcpu-218gb",
          provider_platform: "gpu-rtx6000",
        }}
        onPricingModelChange={onPricingModelChange}
        onSelect={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByRole("radio", { name: "Standard" }));
    expect(onPricingModelChange).toHaveBeenCalledWith("on_demand");
  });
});
