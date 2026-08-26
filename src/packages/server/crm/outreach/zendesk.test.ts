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
      {
        id: "not-a-comment-id",
        public: false,
        author_id: 42,
        plain_body:
          "COCALC_MRR_V1 comment=7 view_observed_at=2026-08-25T12:04:00Z",
      },
    ];
    expect(
      structuredViewObservations({
        ticket: { id: 101 },
        comments,
        config,
        openingCommentId: 7,
      }),
    ).toEqual([
      {
        provider_event_id:
          "my_read_receipts:v2:d84c3d3c300ac8dfa1b4cb1e407844764cb1435da2154f5a45c9acbfadca7631",
        comment_id: 7,
        observed_at: "2026-08-25T12:00:00.000Z",
        provenance: {
          adapter: "private-comment-v1",
          provider: "my_read_receipts",
          zendesk_ticket_id: 101,
          opening_comment_id: 7,
          integration_id: 42,
          receipt_comment_id: 8,
        },
      },
    ]);
  });

  it("binds ticket-field receipt identity to its full canonical provenance", () => {
    const ticketFieldConfig = {
      ...config,
      read_receipts_mode: "ticket_fields",
      read_receipts_ticket_field_ids: "17, 29",
      read_receipts_integration_id: "",
    };
    const observation = ({
      ticketId = 101,
      openingCommentId = 7,
      observedAt = "2026-08-25T12:00:00Z",
      fieldId = 17,
    }: {
      ticketId?: number;
      openingCommentId?: number;
      observedAt?: string;
      fieldId?: number;
    } = {}) =>
      structuredViewObservations({
        ticket: {
          id: ticketId,
          custom_fields: [{ id: fieldId, value: observedAt }],
        },
        comments: [],
        config: ticketFieldConfig,
        openingCommentId,
      })[0];

    const original = observation();
    expect(original).toEqual({
      provider_event_id:
        "my_read_receipts:v2:62a6840a0b922c7055f7cacbe879037976ca2cf3f8ae9ff8b2a5dd71ec10fa30",
      comment_id: 7,
      observed_at: "2026-08-25T12:00:00.000Z",
      provenance: {
        adapter: "ticket-fields-v1",
        provider: "my_read_receipts",
        zendesk_ticket_id: 101,
        opening_comment_id: 7,
        ticket_field_id: 17,
      },
    });
    expect(observation().provider_event_id).toBe(original.provider_event_id);
    expect(observation({ ticketId: 102 }).provider_event_id).not.toBe(
      original.provider_event_id,
    );
    expect(observation({ openingCommentId: 8 }).provider_event_id).not.toBe(
      original.provider_event_id,
    );
    expect(
      observation({ observedAt: "2026-08-25T12:00:01Z" }).provider_event_id,
    ).not.toBe(original.provider_event_id);
    expect(observation({ fieldId: 29 }).provider_event_id).not.toBe(
      original.provider_event_id,
    );
    expect(
      structuredViewObservations({
        ticket: {
          id: 101,
          custom_fields: [{ id: 18, value: "2026-08-25T12:00:00Z" }],
        },
        comments: [],
        config: ticketFieldConfig,
        openingCommentId: 7,
      }),
    ).toEqual([]);
  });

  it("binds private-comment receipt identity to the authenticated integration", () => {
    const receipt = ({
      ticketId = 101,
      openingCommentId = 7,
      integrationId = 42,
    }: {
      ticketId?: number;
      openingCommentId?: number;
      integrationId?: number;
    } = {}) =>
      structuredViewObservations({
        ticket: { id: ticketId },
        comments: [
          {
            id: 8,
            public: false,
            author_id: integrationId,
            plain_body: `COCALC_MRR_V1 comment=${openingCommentId} view_observed_at=2026-08-25T12:00:00Z`,
          },
        ],
        config: {
          ...config,
          read_receipts_integration_id: `${integrationId}`,
        },
        openingCommentId,
      })[0];

    const original = receipt();
    expect(receipt().provider_event_id).toBe(original.provider_event_id);
    expect(receipt({ ticketId: 102 }).provider_event_id).not.toBe(
      original.provider_event_id,
    );
    expect(receipt({ openingCommentId: 8 }).provider_event_id).not.toBe(
      original.provider_event_id,
    );
    expect(receipt({ integrationId: 43 }).provider_event_id).not.toBe(
      original.provider_event_id,
    );
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
