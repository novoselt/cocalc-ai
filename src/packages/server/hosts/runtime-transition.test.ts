/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  getPlannedProjectHostRuntimeTransition,
  isPlannedProjectHostRuntimeTransitionActive,
  isProjectHostUpgradeBannerSuppressed,
} from "./runtime-transition";

describe("planned project-host runtime transitions", () => {
  const now = new Date("2026-07-20T12:00:00.000Z").getTime();

  test("recognizes an active transition and its shorter banner grace window", () => {
    const metadata = {
      runtime_deployments: {
        planned_project_host_transition: {
          operation_id: "op-1",
          component: "project-host",
          target_version: "ph-v2",
          started_at: "2026-07-20T11:59:00.000Z",
          deadline_at: "2026-07-20T12:09:00.000Z",
          banner_suppression_until: "2026-07-20T12:02:00.000Z",
        },
      },
    };

    expect(getPlannedProjectHostRuntimeTransition(metadata)).toMatchObject({
      operation_id: "op-1",
      target_version: "ph-v2",
    });
    expect(isPlannedProjectHostRuntimeTransitionActive(metadata, now)).toBe(
      true,
    );
    expect(isProjectHostUpgradeBannerSuppressed(metadata, now)).toBe(true);
    expect(
      isProjectHostUpgradeBannerSuppressed(metadata, now + 3 * 60_000),
    ).toBe(false);
    expect(
      isPlannedProjectHostRuntimeTransitionActive(metadata, now + 10 * 60_000),
    ).toBe(false);
  });

  test("rejects malformed transition markers", () => {
    expect(
      getPlannedProjectHostRuntimeTransition({
        runtime_deployments: {
          planned_project_host_transition: {
            operation_id: "op-1",
            component: "other",
          },
        },
      }),
    ).toBeUndefined();
  });
});
