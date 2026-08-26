/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  classifyZendeskError,
  structuredViewObservations,
  zendeskTag,
} from "./zendesk";

const config = {
  submitter_id: "1",
  group_id: "2",
  form_id: "",
  support_address: "partnerships@example.test",
  read_receipts_enabled: true,
  read_receipts_mode: "private_comments",
  read_receipts_ticket_field_ids: "",
  read_receipts_integration_id: "42",
};

describe("CRM outreach Zendesk adapter", () => {
  it("normalizes stable bounded tags", () => {
    expect(zendeskTag("CRM-2026-000123 / Adoption Pilot")).toBe(
      "crm-2026-000123_adoption_pilot",
    );
    expect(zendeskTag("***")).toBe("");
    expect(zendeskTag("x".repeat(100))).toHaveLength(80);
  });

  it("accepts only the pinned read-receipt author and exact machine format", () => {
    const comments = [
      {
        id: 8,
        public: false,
        author_id: 42,
        plain_body:
          "COCALC_MRR_V1 comment=7 view_observed_at=2026-08-25T12:00:00Z",
      },
      {
        id: 9,
        public: false,
        author_id: 99,
        plain_body:
          "COCALC_MRR_V1 comment=7 view_observed_at=2026-08-25T12:01:00Z",
      },
      {
        id: 10,
        public: false,
        author_id: 42,
        plain_body:
          "someone says COCALC_MRR_V1 comment=7 view_observed_at=2026-08-25T12:02:00Z",
      },
      {
        id: 11,
        public: false,
        author_id: 42,
        plain_body:
          "COCALC_MRR_V1 comment=6 view_observed_at=2026-08-25T12:03:00Z",
      },
    ];
    expect(
      structuredViewObservations({
        ticket: {},
        comments,
        config,
        openingCommentId: 7,
      }),
    ).toEqual([
      {
        provider_event_id: "my-read-receipts:comment:8",
        comment_id: 7,
        observed_at: "2026-08-25T12:00:00.000Z",
        provenance: {
          adapter: "private-comment-v1",
          integration_id: 42,
          receipt_comment_id: 8,
        },
      },
    ]);
  });

  it("classifies rejection, throttling, and ambiguous transport errors", () => {
    expect(
      classifyZendeskError({
        statusCode: 429,
        response: { headers: { "retry-after": "17" } },
      }),
    ).toMatchObject({ category: "rate_limited", retry_after_seconds: 17 });
    expect(classifyZendeskError({ status: 422 })).toMatchObject({
      category: "rejected",
    });
    expect(classifyZendeskError(Error("socket hang up"))).toMatchObject({
      category: "indeterminate",
    });
    expect(classifyZendeskError({ status: 503 })).toMatchObject({
      category: "indeterminate",
    });
  });
});
