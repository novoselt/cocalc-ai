/*
 *  This file is part of CoCalc: Copyright © 2026, SageMath, Inc.
 *  License: MS-RSL – see https://github.com/sagemathinc/cocalc-ai/blob/master/LICENSE.md
 */

const mockCallHub = jest.fn();
const mockLogger = {
  error: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
};

type Row = {
  id: number;
  kind: "usage" | "finish";
  payload: string;
};

let rows: Row[] = [];

const mockDatabase = {
  exec: jest.fn(),
  prepare: jest.fn((sql: string) => {
    if (sql.includes("SELECT id, kind, payload")) {
      return {
        all: (cursor: number, limit: number) =>
          rows.filter(({ id }) => id > cursor).slice(0, limit),
      };
    }
    if (sql.includes("DELETE FROM site_funded_codex_outbox")) {
      return {
        run: (id: number) => {
          rows = rows.filter((row) => row.id !== id);
        },
      };
    }
    throw new Error(`unexpected SQL: ${sql}`);
  }),
};

jest.mock("@cocalc/backend/logger", () => ({
  __esModule: true,
  default: () => mockLogger,
}));
jest.mock("@cocalc/conat/hub/call-hub", () => ({
  __esModule: true,
  default: (...args: unknown[]) => mockCallHub(...args),
}));
jest.mock("../master-status", () => ({
  getMasterConatClient: () => ({}),
}));
jest.mock("../sqlite/hosts", () => ({
  getLocalHostId: () => "11111111-1111-4111-8111-111111111111",
}));
jest.mock("@cocalc/lite/hub/sqlite/database", () => ({
  getDatabase: () => mockDatabase,
  initDatabase: () => mockDatabase,
}));

import { flushSiteFundedCodexOutbox } from "./codex-site-metering";

function usage(id: number, reservationId: string): Row {
  return {
    id,
    kind: "usage",
    payload: JSON.stringify({ reservationId, eventId: `event-${id}` }),
  };
}

function finish(id: number, reservationId: string): Row {
  return {
    id,
    kind: "finish",
    payload: JSON.stringify({ reservation_id: reservationId }),
  };
}

beforeEach(() => {
  rows = [];
  mockCallHub.mockReset();
  mockLogger.error.mockReset();
  mockLogger.warn.mockReset();
  mockDatabase.exec.mockClear();
  mockDatabase.prepare.mockClear();
});

describe("site-funded Codex durable outbox", () => {
  it("discards terminally stale usage and continues later reservations", async () => {
    rows = [
      usage(1, "stale"),
      finish(2, "stale"),
      usage(3, "current"),
      finish(4, "current"),
    ];
    mockCallHub.mockImplementation(async ({ name, args }) => {
      const payload = args[0]?.event ?? args[0];
      if (
        name === "hosts.recordSiteFundedCodexUsageEvent" &&
        payload.reservationId === "stale"
      ) {
        throw new Error(
          "site-funded Codex reservation is not active (expired)",
        );
      }
      return {};
    });

    await flushSiteFundedCodexOutbox();

    expect(rows).toEqual([]);
    expect(mockCallHub).toHaveBeenCalledTimes(4);
    expect(mockLogger.warn).toHaveBeenCalledWith(
      "discarding stale site-funded Codex usage outbox row",
      expect.objectContaining({ reservationId: "stale" }),
    );
  });

  it("does not let one transiently blocked reservation stop another", async () => {
    rows = [
      usage(1, "blocked"),
      finish(2, "blocked"),
      usage(3, "healthy"),
      finish(4, "healthy"),
    ];
    mockCallHub.mockImplementation(async ({ name, args }) => {
      const payload = args[0]?.event ?? args[0];
      if (
        name === "hosts.recordSiteFundedCodexUsageEvent" &&
        payload.reservationId === "blocked"
      ) {
        throw new Error("temporary network failure");
      }
      return {};
    });

    await flushSiteFundedCodexOutbox();

    expect(rows).toEqual([usage(1, "blocked"), finish(2, "blocked")]);
    // The second pass retries the blocked usage after healthy rows advance.
    expect(mockCallHub).toHaveBeenCalledTimes(4);
    expect(mockCallHub).not.toHaveBeenCalledWith(
      expect.objectContaining({
        name: "hosts.finishSiteFundedCodexTurn",
        args: [{ reservation_id: "blocked" }],
      }),
    );
  });
});
