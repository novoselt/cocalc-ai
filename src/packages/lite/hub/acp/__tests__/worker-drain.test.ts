/*
 *  This file is part of CoCalc: Copyright (C) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { beginAcpWorkerDrain } from "../worker-drain";

describe("beginAcpWorkerDrain", () => {
  it("moves an active worker into drain mode immediately", () => {
    const context = {
      state: "active" as const,
      exit_requested_at: null,
      stop_reason: null,
    };

    beginAcpWorkerDrain({
      context,
      reason: "bundle_upgrade",
      now: 12_345,
    });

    expect(context).toEqual({
      state: "draining",
      exit_requested_at: 12_345,
      stop_reason: "bundle_upgrade",
    });
  });

  it("preserves the original drain deadline when called again", () => {
    const context = {
      state: "draining" as const,
      exit_requested_at: 12_345,
      stop_reason: "bundle_upgrade",
    };

    beginAcpWorkerDrain({ context, reason: " ", now: 99_999 });

    expect(context).toEqual({
      state: "draining",
      exit_requested_at: 12_345,
      stop_reason: "bundle_upgrade",
    });
  });
});
