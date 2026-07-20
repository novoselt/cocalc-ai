/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { __test__ } from "./runtime-fleet-rollout-worker";

describe("project-host fleet rollout planning", () => {
  test("accepts an aligned build whose deployment and build IDs differ", () => {
    expect(
      __test__.projectHostObservationIsStable({
        version: "artifact-v2",
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
      __test__.projectHostObservationIsStable({
        version: "artifact-v2",
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
