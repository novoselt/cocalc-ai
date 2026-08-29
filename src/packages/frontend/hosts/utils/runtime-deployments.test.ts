import {
  runtimeDeploymentsForManagedComponentVersion,
  shouldAlignRuntimeStackForSoftwareArtifacts,
  withoutRuntimeArtifactOverride,
} from "./runtime-deployments";

describe("withoutRuntimeArtifactOverride", () => {
  it("removes only the selected artifact and preserves component overrides", () => {
    const deployments = [
      {
        target_type: "artifact" as const,
        target: "project-host" as const,
        desired_version: "ph-v2",
      },
      {
        target_type: "component" as const,
        target: "acp-worker" as const,
        desired_version: "ph-v1",
      },
      {
        target_type: "artifact" as const,
        target: "tools" as const,
        desired_version: "tools-v1",
      },
    ];

    expect(
      withoutRuntimeArtifactOverride({
        deployments,
        artifact: "project-host",
      }),
    ).toEqual([deployments[1], deployments[2]]);
  });
});

describe("runtimeDeploymentsForManagedComponentVersion", () => {
  it("pins the matching project-host artifact alongside the component target", () => {
    expect(
      runtimeDeploymentsForManagedComponentVersion({
        component: "conat-router",
        desired_version: "  ph-v2  ",
        rollout_reason: "frontend hub deploy",
      }),
    ).toEqual([
      {
        target_type: "artifact",
        target: "project-host",
        desired_version: "ph-v2",
        rollout_reason: "frontend hub deploy",
      },
      {
        target_type: "component",
        target: "conat-router",
        desired_version: "ph-v2",
        rollout_reason: "frontend hub deploy",
      },
    ]);
  });

  it("returns no deployments for a blank desired version", () => {
    expect(
      runtimeDeploymentsForManagedComponentVersion({
        component: "project-host",
        desired_version: "   ",
      }),
    ).toEqual([]);
  });
});

describe("shouldAlignRuntimeStackForSoftwareArtifacts", () => {
  it("aligns the runtime stack for project-host upgrades", () => {
    expect(
      shouldAlignRuntimeStackForSoftwareArtifacts({
        artifacts: ["project-host", "project", "tools"],
      }),
    ).toBe(true);
  });

  it("does not align the runtime stack for non-project-host upgrades by default", () => {
    expect(
      shouldAlignRuntimeStackForSoftwareArtifacts({
        artifacts: ["project", "tools"],
      }),
    ).toBe(false);
  });

  it("preserves an explicit align request", () => {
    expect(
      shouldAlignRuntimeStackForSoftwareArtifacts({
        artifacts: ["tools"],
        alignRuntimeStack: true,
      }),
    ).toBe(true);
  });
});
