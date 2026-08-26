/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { outreachFollowupIneligibilityReason } from "./store";

const eligible = {
  delivery_state: "notification_requested",
  replied_at: null,
  task_state: "waiting",
  follow_up_attempt_count: 0,
  max_followups: 2,
  suppressed: false,
  pending_operation: false,
  provider_attempt_number: 1,
  provider_retry_max_attempts: 8,
};

describe("CRM outreach follow-up persistence invariants", () => {
  it("accepts only a waiting, unanswered, unsuppressed delivery", () => {
    expect(outreachFollowupIneligibilityReason(eligible)).toBeUndefined();
    expect(
      outreachFollowupIneligibilityReason({ ...eligible, suppressed: true }),
    ).toBe("recipient is suppressed");
    expect(
      outreachFollowupIneligibilityReason({
        ...eligible,
        replied_at: "2026-08-26T12:00:00Z",
      }),
    ).toBe("recipient has already replied");
    expect(
      outreachFollowupIneligibilityReason({
        ...eligible,
        delivery_state: "closed",
      }),
    ).toContain("not notification_requested");
    expect(
      outreachFollowupIneligibilityReason({
        ...eligible,
        task_state: "completed",
      }),
    ).toBe("follow-up task is no longer open or waiting");
  });

  it("blocks duplicate, exhausted, and over-retried comments", () => {
    expect(
      outreachFollowupIneligibilityReason({
        ...eligible,
        follow_up_attempt_count: 2,
      }),
    ).toBe("maximum reviewed follow-ups reached");
    expect(
      outreachFollowupIneligibilityReason({
        ...eligible,
        provider_attempt_number: 9,
      }),
    ).toBe("maximum provider attempts reached");
    expect(
      outreachFollowupIneligibilityReason({
        ...eligible,
        pending_operation: true,
      }),
    ).toBe("a reviewed follow-up is already pending");
  });
});
