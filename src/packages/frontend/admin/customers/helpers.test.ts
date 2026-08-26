/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { CrmActivity } from "@cocalc/util/crm";
import {
  crmMutationContext,
  filterCrmActivities,
  safeExternalHttpUrl,
} from "./helpers";

test("CRM committed mutations carry the browser identity from fresh auth", () => {
  expect(
    crmMutationContext({
      browserId: "browser-123",
      commit: true,
      previous: {
        preview: true,
        expected_version: 7,
        idempotency_key: "crm-task-123",
        proposed: {},
        warnings: [],
      },
      reason: "Schedule procurement follow-up",
    }),
  ).toEqual({
    browser_id: "browser-123",
    commit: true,
    expected_version: 7,
    idempotency_key: "crm-task-123",
    reason: "Schedule procurement follow-up",
    source: "admin-ui",
  });
});

test("timeline filtering searches humanized activity kinds and details", () => {
  const activities = [
    {
      id: "activity-1",
      organization_id: "organization-1",
      kind: "commercial_order",
      source: "commercial-orders",
      source_id: "AR-2026-0001",
      summary: "Invoice paid",
      details: "Payment settled in full",
      occurred_at: "2026-08-25T10:00:00.000Z",
      metadata: {},
      created_at: "2026-08-25T10:00:00.000Z",
    },
    {
      id: "activity-2",
      organization_id: "organization-1",
      kind: "zendesk",
      source: "admin-ui",
      source_id: "20599",
      summary: "Support ticket linked",
      zendesk_ticket_id: 20599,
      occurred_at: "2026-08-24T10:00:00.000Z",
      metadata: {},
      created_at: "2026-08-24T10:00:00.000Z",
    },
  ] satisfies CrmActivity[];

  expect(filterCrmActivities(activities, "commercial order")).toEqual([
    activities[0],
  ]);
  expect(filterCrmActivities(activities, "settled")).toEqual([activities[0]]);
  expect(filterCrmActivities(activities, "20599")).toEqual([activities[1]]);
  expect(filterCrmActivities(activities, "")).toEqual(activities);
});

test("customer website links only allow HTTP and HTTPS URLs", () => {
  expect(safeExternalHttpUrl("https://example.com/customer")).toBe(
    "https://example.com/customer",
  );
  expect(safeExternalHttpUrl("javascript:alert(1)")).toBeUndefined();
  expect(
    safeExternalHttpUrl("https://user:secret@example.com"),
  ).toBeUndefined();
  expect(safeExternalHttpUrl("not a URL")).toBeUndefined();
});
