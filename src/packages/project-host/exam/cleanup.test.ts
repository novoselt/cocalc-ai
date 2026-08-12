/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { isExamCleanupDue, isExamSessionExpired } from "./cleanup";

describe("exam cleanup timing", () => {
  it("starts scheduled cleanup at the stop time", () => {
    expect(
      isExamCleanupDue({
        cleanup_mode: "scheduled",
        scheduled_stop_at_ms: 100,
        now_ms: 100,
      }),
    ).toBe(true);
  });

  it("keeps scheduled sessions valid through the cleanup grace period", () => {
    expect(
      isExamSessionExpired({
        cleanup_mode: "scheduled",
        cleanup_deadline_at_ms: 110,
        now_ms: 100,
      }),
    ).toBe(false);
    expect(
      isExamSessionExpired({
        cleanup_mode: "scheduled",
        cleanup_deadline_at_ms: 110,
        now_ms: 110,
      }),
    ).toBe(true);
  });

  it("never automatically cleans up or expires manual practice runs", () => {
    expect(
      isExamCleanupDue({
        cleanup_mode: "manual",
        scheduled_stop_at_ms: 0,
        now_ms: 1,
      }),
    ).toBe(false);
    expect(
      isExamSessionExpired({
        cleanup_mode: "manual",
        cleanup_deadline_at_ms: 0,
        now_ms: 1,
      }),
    ).toBe(false);
  });
});
