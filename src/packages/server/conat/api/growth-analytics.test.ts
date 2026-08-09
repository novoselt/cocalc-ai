/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { ingestGrowthEvent } from "@cocalc/server/growth-analytics/ingest";
import { recordEvent } from "./growth-analytics";

jest.mock("@cocalc/server/growth-analytics/ingest", () => ({
  ingestGrowthEvent: jest.fn(async () => ({ recorded: true })),
}));

const EVENT_ID = "362e5636-d003-4a6c-b9fa-c0f36f6831b2";
const ACCOUNT_ID = "61caa39d-2583-4d77-abd0-b2b3f957701b";

describe("growth analytics browser API", () => {
  beforeEach(() => jest.clearAllMocks());

  it("accepts browser activity while replacing trust-sensitive fields", async () => {
    await recordEvent({
      account_id: ACCOUNT_ID,
      event: {
        event_id: EVENT_ID,
        event_name: "project_work",
        occurred_at: "2020-01-01T00:00:00.000Z",
        source_component: "hub",
        experiment: "forged-experiment",
        properties: {
          action_category: "jupyter_execute",
          auth_method: "forged-auth",
          source_confidence: "server",
        },
      },
    });

    expect(ingestGrowthEvent).toHaveBeenCalledWith({
      account_id: ACCOUNT_ID,
      event: expect.objectContaining({
        event_id: EVENT_ID,
        event_name: "project_work",
        source_component: "browser",
        experiment: undefined,
        variant: undefined,
        properties: {
          action_category: "jupyter_execute",
          source_confidence: "browser",
        },
      }),
    });
    const ingested = (ingestGrowthEvent as jest.Mock).mock.calls[0][0].event;
    expect(new Date(ingested.occurred_at).getTime()).toBeGreaterThan(
      Date.now() - 5_000,
    );
  });

  it("rejects server-authoritative milestones from browsers", async () => {
    await expect(
      recordEvent({
        account_id: ACCOUNT_ID,
        event: { event_id: EVENT_ID, event_name: "identity_proved" },
      }),
    ).rejects.toThrow("not accepted from a browser");
    expect(ingestGrowthEvent).not.toHaveBeenCalled();
  });
});
