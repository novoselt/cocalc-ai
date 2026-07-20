/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { __test__ } from "./runtime-fleet-rollout-worker";

describe("project-host fleet rollout planning", () => {
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
