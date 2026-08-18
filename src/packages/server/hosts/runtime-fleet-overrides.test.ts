/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  hostOverridesAnyRolloutTarget,
  hostOverridesEveryRolloutTarget,
  runtimeFleetDeploymentTargetKeys,
  type RuntimeDeploymentTargetKey,
} from "./runtime-fleet-overrides";

describe("runtime fleet deployment overrides", () => {
  test("project-host rollout covers its artifact and component", () => {
    expect(runtimeFleetDeploymentTargetKeys(["project-host"])).toEqual([
      "artifact:project-host",
      "component:project-host",
    ]);
    expect(runtimeFleetDeploymentTargetKeys(["acp-worker"])).toEqual([
      "component:acp-worker",
    ]);
  });

  test("distinguishes partial pins from complete rollout isolation", () => {
    const rolloutTargetKeys = runtimeFleetDeploymentTargetKeys([
      "project-host",
    ]);
    const partial = new Map<string, Set<RuntimeDeploymentTargetKey>>([
      ["host-a", new Set(["component:project-host"])],
    ]);
    expect(
      hostOverridesAnyRolloutTarget({
        hostId: "host-a",
        overrideKeysByHost: partial,
        rolloutTargetKeys,
      }),
    ).toBe(true);
    expect(
      hostOverridesEveryRolloutTarget({
        hostId: "host-a",
        overrideKeysByHost: partial,
        rolloutTargetKeys,
      }),
    ).toBe(false);

    partial.get("host-a")!.add("artifact:project-host");
    expect(
      hostOverridesEveryRolloutTarget({
        hostId: "host-a",
        overrideKeysByHost: partial,
        rolloutTargetKeys,
      }),
    ).toBe(true);
  });
});
