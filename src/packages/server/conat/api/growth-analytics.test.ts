/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { ingestGrowthEvent } from "@cocalc/server/growth-analytics/ingest";
import { browserGrowthEventId, recordEvent } from "./growth-analytics";

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
        event_id: expect.stringMatching(
          /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        ),
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

  it("deduplicates browser retries within the event sampling window", () => {
    const now = new Date("2026-08-09T12:01:00.000Z");
    const first = browserGrowthEventId({
      accountId: ACCOUNT_ID,
      eventName: "project_work",
      actionCategory: "editor_save",
      now,
    });
    expect(
      browserGrowthEventId({
        accountId: ACCOUNT_ID,
        eventName: "project_work",
        actionCategory: "editor_save",
        now: new Date(now.getTime() + 60_000),
      }),
    ).toBe(first);
    expect(
      browserGrowthEventId({
        accountId: ACCOUNT_ID,
        eventName: "project_work",
        actionCategory: "editor_save",
        now: new Date(now.getTime() + 5 * 60_000),
      }),
    ).not.toBe(first);
  });

  it("does not collapse distinct onboarding choices", () => {
    const now = new Date("2026-08-09T12:01:00.000Z");
    const jupyter = browserGrowthEventId({
      accountId: ACCOUNT_ID,
      eventName: "onboarding_path_selected",
      onboardingPath: "jupyter",
      outcome: "section",
      now,
    });
    expect(
      browserGrowthEventId({
        accountId: ACCOUNT_ID,
        eventName: "onboarding_path_selected",
        onboardingPath: "jupyter-python",
        outcome: "project-path",
        now,
      }),
    ).not.toBe(jupyter);
    expect(
      browserGrowthEventId({
        accountId: ACCOUNT_ID,
        eventName: "onboarding_path_selected",
        onboardingPath: "jupyter",
        outcome: "section",
        now,
      }),
    ).toBe(jupyter);
  });

  it("rejects unknown browser action categories", async () => {
    await expect(
      recordEvent({
        account_id: ACCOUNT_ID,
        event: {
          event_id: EVENT_ID,
          event_name: "project_work",
          properties: { action_category: "forged" as any },
        },
      }),
    ).rejects.toThrow("action_category is not accepted from a browser");
    expect(ingestGrowthEvent).not.toHaveBeenCalled();
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

  it("accepts first-run milestones and preserves only safe dimensions", async () => {
    await recordEvent({
      account_id: ACCOUNT_ID,
      event: {
        event_id: EVENT_ID,
        event_name: "project_create_started",
        properties: {
          onboarding_path: "codex",
          outcome: "started",
          auth_method: "must-not-pass-through",
        },
      },
    });

    expect(ingestGrowthEvent).toHaveBeenCalledWith({
      account_id: ACCOUNT_ID,
      event: expect.objectContaining({
        event_name: "project_create_started",
        properties: {
          onboarding_path: "codex",
          outcome: "started",
          source_confidence: "browser",
        },
      }),
    });
  });

  it.each([
    "onboarding_path_selected",
    "onboarding_configuration_seen",
    "onboarding_configuration_ready",
  ] as const)("accepts the %s diagnostic event", async (event_name) => {
    await recordEvent({
      account_id: ACCOUNT_ID,
      event: {
        event_id: EVENT_ID,
        event_name,
        properties: {
          onboarding_path: "jupyter-python",
          outcome: "visible",
        },
      },
    });

    expect(ingestGrowthEvent).toHaveBeenCalledWith({
      account_id: ACCOUNT_ID,
      event: expect.objectContaining({
        event_name,
        properties: {
          onboarding_path: "jupyter-python",
          outcome: "visible",
          source_confidence: "browser",
        },
      }),
    });
  });
});
