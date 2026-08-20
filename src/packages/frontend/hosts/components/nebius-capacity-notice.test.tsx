import { render, screen } from "@testing-library/react";

import type { HostCatalog } from "@cocalc/conat/hub/api/hosts";
import { NebiusCapacityNotice } from "./nebius-capacity-notice";

const catalog: HostCatalog = {
  provider_capabilities: {},
  entries: [
    {
      kind: "instance_types",
      scope: "global",
      payload: [
        {
          name: "1gpu-24vcpu-218gb",
          platform: "gpu-rtx6000",
          memory_gib: 218,
        },
      ],
    },
    {
      kind: "capacity_advice",
      scope: "global",
      payload: [
        {
          region: "us-central1",
          fabric: "fabric-1",
          platform: "gpu-rtx6000",
          machine_type: "1gpu-24vcpu-218gb",
          spot: {
            available: 42,
            limit: 128,
            availability_level: "medium",
            data_state: "fresh",
          },
        },
      ],
    },
  ],
};

describe("NebiusCapacityNotice", () => {
  it("presents current advisory data in an accessible alert", () => {
    render(
      <NebiusCapacityNotice
        catalog={catalog}
        selection={{
          region: "us-central1",
          machine_type: "1gpu-24vcpu-218gb",
          pricing_model: "spot",
        }}
      />,
    );

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Spot capacity: medium");
    expect(alert).toHaveTextContent("42 available, quota 128");
    expect(alert).toHaveTextContent("fabric-1");
    expect(alert).toHaveTextContent("does not reserve a VM");
  });

  it("explains when no capacity report is available", () => {
    render(
      <NebiusCapacityNotice
        catalog={catalog}
        selection={{
          region: "eu-north1",
          machine_type: "1gpu-24vcpu-218gb",
          pricing_model: "on_demand",
        }}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Standard capacity: not reported for this machine and region",
    );
  });
});
