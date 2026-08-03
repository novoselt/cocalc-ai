/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  ioClassFromSharedComputePriority,
  normalizeMembershipProjectDefaults,
  normalizeSharedComputePriority,
  runtimeSchedulingFromSharedComputePriority,
} from "./project-defaults";

describe("normalizeMembershipProjectDefaults", () => {
  it("keeps cocalc-ai project resource defaults and filters legacy knobs", () => {
    expect(
      normalizeMembershipProjectDefaults({
        memory: "4000",
        memory_request: 500,
        disk_quota: true,
        cores: 32,
        cpu_shares: 1024,
        network: 0,
        member_host: 0,
        mintime: 3600,
        always_running: 1,
        ephemeral_state: 1,
        ephemeral_disk: 1,
      } as any),
    ).toEqual({
      memory: 4000,
      memory_request: 500,
      disk_quota: 1,
    });
  });
});

describe("membership project I/O class", () => {
  it.each([
    [undefined, "standard"],
    [0, "standard"],
    [1, "member"],
    [2, "member"],
    [4, "premium"],
    [99, "premium"],
  ])("maps shared compute priority %p to %s", (priority, expected) => {
    expect(ioClassFromSharedComputePriority(priority)).toBe(expected);
  });

  it.each([
    [undefined, 0],
    [-1, 0],
    [0, 0],
    [1.9, 1],
    ["4", 4],
  ])("normalizes shared compute priority %p to %p", (priority, expected) => {
    expect(normalizeSharedComputePriority(priority)).toBe(expected);
  });

  it("preserves exact CPU priority alongside the storage class", () => {
    expect(runtimeSchedulingFromSharedComputePriority(2)).toEqual({
      io_class: "member",
      shared_compute_priority: 2,
    });
  });
});
