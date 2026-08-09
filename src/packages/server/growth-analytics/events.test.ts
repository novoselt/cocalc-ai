/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { validateGrowthEvent } from "./events";

const NOW = new Date("2026-08-09T12:00:00.000Z");
const EVENT_ID = "5db11676-014a-48bb-b7fc-64aec21c7811";

describe("growth event validation", () => {
  it("accepts a bounded semantic action without user content", () => {
    expect(
      validateGrowthEvent(
        {
          event_id: EVENT_ID,
          event_name: "project_work",
          occurred_at: "2026-08-09T11:59:00.000Z",
          source_component: "browser",
          properties: { action_category: "jupyter_execute" },
        },
        NOW,
      ),
    ).toMatchObject({
      event_id: EVENT_ID,
      event_name: "project_work",
      source_component: "browser",
      properties: { action_category: "jupyter_execute" },
    });
  });

  it("rejects unknown payload fields so content cannot leak into analytics", () => {
    expect(() =>
      validateGrowthEvent(
        {
          event_id: EVENT_ID,
          event_name: "project_work",
          properties: { prompt: "private input" } as any,
        },
        NOW,
      ),
    ).toThrow("property 'prompt' is not allowed");
  });

  it("rejects stale and future-dated events", () => {
    expect(() =>
      validateGrowthEvent(
        {
          event_id: EVENT_ID,
          event_name: "project_work",
          occurred_at: "2026-01-01T00:00:00.000Z",
        },
        NOW,
      ),
    ).toThrow("outside the raw-event retention window");
    expect(() =>
      validateGrowthEvent(
        {
          event_id: EVENT_ID,
          event_name: "project_work",
          occurred_at: "2026-08-09T12:10:00.000Z",
        },
        NOW,
      ),
    ).toThrow("too far in the future");
  });
});
