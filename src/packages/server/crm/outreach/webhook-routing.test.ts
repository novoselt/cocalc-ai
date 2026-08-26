/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

export {};

const getConfiguredBayIdMock = jest.fn();
const getConfiguredClusterSeedBayIdMock = jest.fn();
const ingestInternalMock = jest.fn();
const bayOpsMock = jest.fn(() => ({
  ingestCrmOutreachZendeskEventInternal: ingestInternalMock,
}));
const queryMock = jest.fn();

jest.mock("@cocalc/server/bay-config", () => ({
  getConfiguredBayId: () => getConfiguredBayIdMock(),
}));

jest.mock("@cocalc/server/cluster-config", () => ({
  getConfiguredClusterSeedBayId: () => getConfiguredClusterSeedBayIdMock(),
}));

jest.mock("@cocalc/server/inter-bay/bridge", () => ({
  getInterBayBridge: () => ({ bayOps: bayOpsMock }),
}));

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({ query: queryMock }),
}));

const EVENT = {
  event_id: "event-1",
  event_type: "ticket.comment_created",
  zendesk_ticket_id: 20599,
  zendesk_comment_id: 31415,
  occurred_at: "2026-08-26T12:00:00.000Z",
  payload: {
    ticket_status: "open",
    source: "zendesk-webhook",
  },
};

describe("CRM outreach Zendesk event inter-bay routing", () => {
  beforeEach(() => {
    getConfiguredBayIdMock.mockReturnValue("bay-1");
    getConfiguredClusterSeedBayIdMock.mockReturnValue("bay-0");
    ingestInternalMock.mockReset().mockResolvedValue(undefined);
    bayOpsMock.mockClear();
    queryMock.mockReset().mockResolvedValue({ rows: [] });
  });

  it("uses the narrow internal operation without a human actor", async () => {
    const { enqueueOutreachZendeskEvent } = await import("./webhook");

    await enqueueOutreachZendeskEvent(EVENT);

    expect(bayOpsMock).toHaveBeenCalledWith("bay-0", {
      timeout_ms: 30_000,
    });
    expect(ingestInternalMock).toHaveBeenCalledWith({ event: EVENT });
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("rejects malformed events before forwarding them", async () => {
    const { enqueueOutreachZendeskEvent } = await import("./webhook");

    await expect(
      enqueueOutreachZendeskEvent({
        ...EVENT,
        zendesk_ticket_id: -1,
      }),
    ).rejects.toThrow("zendesk_ticket_id must be a positive integer");
    expect(ingestInternalMock).not.toHaveBeenCalled();

    await expect(
      enqueueOutreachZendeskEvent({
        ...EVENT,
        occurred_at: undefined,
      } as any),
    ).rejects.toThrow("occurred_at must be a timestamp string");
    expect(ingestInternalMock).not.toHaveBeenCalled();
  });

  it("propagates internal forwarding failures", async () => {
    const { enqueueOutreachZendeskEvent } = await import("./webhook");
    ingestInternalMock.mockRejectedValueOnce(new Error("seed unavailable"));

    await expect(enqueueOutreachZendeskEvent(EVENT)).rejects.toThrow(
      "seed unavailable",
    );
  });

  it("revalidates and bounds an event before a seed-side insert", async () => {
    const { enqueueOutreachZendeskEvent } = await import("./webhook");
    getConfiguredBayIdMock.mockReturnValue("bay-0");

    await enqueueOutreachZendeskEvent({
      ...EVENT,
      event_id: " event-1 ",
      payload: {
        ticket_status: "x".repeat(80),
        source: "y".repeat(150),
        ignored: "not persisted",
      },
    } as any);

    expect(queryMock).toHaveBeenCalledTimes(1);
    expect(queryMock.mock.calls[0][1]).toEqual([
      "event-1",
      20599,
      31415,
      "ticket.comment_created",
      "2026-08-26T12:00:00.000Z",
      {
        ticket_status: "x".repeat(50),
        source: "y".repeat(100),
      },
    ]);
    expect(ingestInternalMock).not.toHaveBeenCalled();
  });
});
