/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { ComputeVm } from "@cocalc/conat/hub/api/compute";
import { vmStartupExpectation } from "./compute-vms-startup";

const NOW = Date.parse("2026-08-22T01:00:00.000Z");

function vm(overrides: Partial<ComputeVm> = {}) {
  return {
    provider: "nebius",
    state: "starting",
    desired_state: "running",
    ...overrides,
  } as ComputeVm;
}

describe("vmStartupExpectation", () => {
  it("sets expectations before a provider generation is recorded", () => {
    expect(vmStartupExpectation(vm(), NOW)).toEqual({
      text: "Usually SSH-ready in about 2 min",
      takingLongerThanUsual: false,
    });
  });

  it("shows elapsed startup time from the current generation", () => {
    expect(
      vmStartupExpectation(
        vm({
          current_instance_timing: {
            generation: 2,
            created_at: new Date(NOW - 48_000),
          },
        }),
        NOW,
      ),
    ).toEqual({
      text: "Usually SSH-ready in about 2 min · 48s elapsed",
      takingLongerThanUsual: false,
    });
  });

  it("calls out starts that exceed twice the usual duration", () => {
    expect(
      vmStartupExpectation(
        vm({
          current_instance_timing: {
            generation: 3,
            created_at: new Date(NOW - 4 * 60_000 - 12_000),
          },
        }),
        NOW,
      ),
    ).toEqual({
      text: "Taking longer than usual · 4m 12s elapsed",
      takingLongerThanUsual: true,
    });
  });

  it("does not make an estimate for other providers or settled VMs", () => {
    expect(vmStartupExpectation(vm({ provider: "gcp" }), NOW)).toBeUndefined();
    expect(vmStartupExpectation(vm({ state: "ready" }), NOW)).toBeUndefined();
    expect(
      vmStartupExpectation(vm({ desired_state: "stopped" }), NOW),
    ).toBeUndefined();
  });
});
