/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { __test__ } from "./runtime-fleet-rollout-worker";

describe("host runtime fleet rollout planning", () => {
  test("accepts an aligned build whose deployment and build IDs differ", () => {
    expect(
      __test__.runtimeObservationIsStable({
        version: "artifact-v2",
        components: ["project-host"],
        status: {
          host_id: "host-a",
          configured: [],
          effective: [],
          observed_artifacts: [
            {
              artifact: "project-host",
              current_version: "artifact-v2",
              current_build_id: "build-v2",
              installed_versions: ["artifact-v2"],
            },
          ],
          observed_components: [
            {
              component: "project-host",
              artifact: "project-host",
              runtime_state: "running",
              version_state: "aligned",
              running_versions: ["build-v2"],
              running_pids: [123],
            },
          ],
          observed_targets: [],
          observed_host_agent: {
            project_host: {
              rollout: {
                phase: "promoted",
                target_version: "artifact-v2",
                running_version: "artifact-v2",
                healthy: true,
              },
            },
          },
        },
      }),
    ).toBe(true);
  });

  test("rejects an artifact after the host agent rolls it back", () => {
    expect(
      __test__.runtimeObservationIsStable({
        version: "artifact-v2",
        components: ["project-host"],
        status: {
          host_id: "host-a",
          configured: [],
          effective: [],
          observed_artifacts: [
            {
              artifact: "project-host",
              current_version: "artifact-v1",
              installed_versions: ["artifact-v1", "artifact-v2"],
            },
          ],
          observed_components: [
            {
              component: "project-host",
              artifact: "project-host",
              runtime_state: "running",
              version_state: "aligned",
              running_versions: ["build-v1"],
              running_pids: [123],
            },
          ],
          observed_targets: [],
          observed_host_agent: {
            project_host: {
              rollout: {
                phase: "rolled_back",
                target_version: "artifact-v2",
                running_version: "artifact-v1",
                healthy: false,
              },
            },
          },
        },
      }),
    ).toBe(false);
  });

  test("requires every selected auxiliary component to be aligned", () => {
    const status = {
      host_id: "host-a",
      configured: [],
      effective: [],
      observed_artifacts: [
        {
          artifact: "project-host" as const,
          current_version: "artifact-v2",
          installed_versions: ["artifact-v2"],
        },
      ],
      observed_components: [
        {
          component: "project-host" as const,
          artifact: "project-host" as const,
          runtime_state: "running" as const,
          version_state: "aligned" as const,
          running_versions: ["build-v2"],
          running_pids: [123],
        },
        {
          component: "acp-worker" as const,
          artifact: "project-host" as const,
          runtime_state: "running" as const,
          version_state: "drifted" as const,
          running_versions: ["build-v1"],
          running_pids: [456],
        },
      ],
      observed_targets: [],
      observed_host_agent: {
        project_host: {
          rollout: {
            phase: "promoted" as const,
            target_version: "artifact-v2",
            running_version: "artifact-v2",
            healthy: true,
          },
        },
      },
    };
    expect(
      __test__.runtimeObservationIsStable({
        status,
        version: "artifact-v2",
        components: ["acp-worker"],
      }),
    ).toBe(false);
    status.observed_components[1].version_state = "aligned";
    expect(
      __test__.runtimeObservationIsStable({
        status,
        version: "artifact-v2",
        components: ["acp-worker"],
      }),
    ).toBe(true);
  });

  test("defaults old durable operations to project-host and rejects invalid input", () => {
    expect(__test__.normalizedRolloutComponents(undefined)).toEqual([
      "project-host",
    ]);
    expect(
      __test__.normalizedRolloutComponents(["acp-worker", "acp-worker"]),
    ).toEqual(["acp-worker"]);
    expect(() => __test__.normalizedRolloutComponents(["unknown"])).toThrow(
      "unsupported managed component",
    );
  });

  test("promotes only selected components with service-specific policies", () => {
    expect(
      __test__.runtimeDeploymentsForPromotion({
        version: "artifact-v2",
        components: ["conat-router", "acp-worker"],
        reason: "test",
        metadata: { campaign: "op-1" },
      }),
    ).toEqual([
      expect.objectContaining({
        target_type: "artifact",
        target: "project-host",
        desired_version: "artifact-v2",
      }),
      expect.objectContaining({
        target_type: "component",
        target: "project-host",
        rollout_policy: "restart_now",
      }),
      expect.objectContaining({
        target_type: "component",
        target: "conat-router",
        rollout_policy: "restart_now",
      }),
      expect.objectContaining({
        target_type: "component",
        target: "acp-worker",
        rollout_policy: "drain_then_replace",
      }),
    ]);
  });

  test("isolates the canary before bounded waves", () => {
    expect(
      __test__.buildRolloutWaves({
        host_ids: ["canary", "host-b", "host-c", "host-d", "host-e"],
        completed_host_ids: new Set(),
        canary_host_id: "canary",
        max_concurrent: 2,
        canary_stabilize_seconds: 180,
        stabilize_seconds: 60,
      }),
    ).toEqual([
      { ids: ["canary"], stabilize_seconds: 180 },
      { ids: ["host-b", "host-c"], stabilize_seconds: 60 },
      { ids: ["host-d", "host-e"], stabilize_seconds: 60 },
    ]);
  });

  test("resumes after durable successful hosts without repeating them", () => {
    expect(
      __test__.buildRolloutWaves({
        host_ids: ["canary", "host-b", "host-c"],
        completed_host_ids: new Set(["canary", "host-b"]),
        canary_host_id: "canary",
        max_concurrent: 2,
        canary_stabilize_seconds: 180,
        stabilize_seconds: 60,
      }),
    ).toEqual([{ ids: ["host-c"], stabilize_seconds: 60 }]);
  });
});
