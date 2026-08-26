/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  cancelIneligibleQueuedFollowups,
  observeCreateTicketAbsence,
  reclaimStaleWebhookEvents,
  recoverExpiredProviderOperations,
} from "./worker";

function queryResult(rowCount: number) {
  return { rows: Array.from({ length: rowCount }, () => ({})), rowCount };
}

describe("CRM outreach worker recovery invariants", () => {
  it("moves expired effectful claims to indeterminate and safely requeues reads", async () => {
    const query = jest
      .fn()
      .mockResolvedValueOnce(queryResult(2))
      .mockResolvedValueOnce(queryResult(1));

    await expect(
      recoverExpiredProviderOperations({ query } as any),
    ).resolves.toEqual({
      effectful_indeterminate: 2,
      reconciliation_requeued: 1,
    });
    expect(query.mock.calls[0][0]).toContain("state='indeterminate'");
    expect(query.mock.calls[0][0]).toContain(
      "operation IN ('create_ticket','add_comment')",
    );
    expect(query.mock.calls[0][0]).toContain("lease_expires_at<NOW()");
    expect(query.mock.calls[1][0]).toContain("operation='reconcile_ticket'");
    expect(query.mock.calls[1][0]).toContain("state='queued'");
  });

  it("returns stale processing webhooks to the bounded retry queue", async () => {
    const query = jest.fn().mockResolvedValue(queryResult(3));

    await expect(reclaimStaleWebhookEvents({ query } as any)).resolves.toBe(3);
    expect(query.mock.calls[0][0]).toContain("state='processing'");
    expect(query.mock.calls[0][0]).toContain("state='failed'");
    expect(query.mock.calls[0][0]).toContain("updated_at<NOW()");
    expect(query.mock.calls[0][1]).toEqual([120_000]);
  });

  it("cancels queued comments that became unsafe before claim", async () => {
    const query = jest.fn().mockResolvedValue(queryResult(4));

    await expect(
      cancelIneligibleQueuedFollowups(8, { query } as any),
    ).resolves.toBe(4);
    const sql = query.mock.calls[0][0];
    expect(sql).toContain("p.operation='add_comment'");
    expect(sql).toContain("p.state='queued'");
    expect(sql).toContain("d.replied_at IS NOT NULL");
    expect(sql).toContain("d.follow_up_attempt_count>=d.max_followups");
    expect(sql).toContain("crm_contact_suppressions");
    expect(query.mock.calls[0][1]).toEqual([8]);
  });

  it("requires repeated absence observations across the grace window", () => {
    const start = Date.parse("2026-08-26T12:00:00.000Z");
    const first = observeCreateTicketAbsence({}, start);
    const second = observeCreateTicketAbsence(
      first.request_payload,
      start + 60_000,
    );
    const third = observeCreateTicketAbsence(
      second.request_payload,
      start + 4 * 60_000,
    );
    const afterGrace = observeCreateTicketAbsence(
      third.request_payload,
      start + 5 * 60_000,
    );

    expect(first.definitive).toBe(false);
    expect(second.definitive).toBe(false);
    expect(third.definitive).toBe(false);
    expect(afterGrace.definitive).toBe(true);
    expect(afterGrace.request_payload).toMatchObject({
      absence_first_observed_at: "2026-08-26T12:00:00.000Z",
      absence_last_observed_at: "2026-08-26T12:05:00.000Z",
      absence_observation_count: 4,
    });
  });
});
