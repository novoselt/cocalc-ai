/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import centralLog from "@cocalc/database/postgres/central-log";
import getPool from "@cocalc/database/pool";
import isAdmin from "@cocalc/server/accounts/is-admin";
import getZendeskClient from "@cocalc/server/support/zendesk-client";
import { requireDangerousSessionAuth } from "./dangerous-session-auth";

import {
  buildTriageGroups,
  list,
  merge,
  planMerge,
  planUpdate,
  redactSupportText,
  search,
  show,
  update,
} from "./admin-support";

jest.mock("@cocalc/database/postgres/central-log", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("@cocalc/server/accounts/is-admin", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("@cocalc/server/support/zendesk-client", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("./dangerous-session-auth", () => ({
  requireDangerousSessionAuth: jest.fn(),
}));

const mockCentralLog = jest.mocked(centralLog);
const mockGetPool = jest.mocked(getPool);
const mockIsAdmin = jest.mocked(isAdmin);
const mockGetZendeskClient = jest.mocked(getZendeskClient);
const mockRequireDangerousSessionAuth = jest.mocked(
  requireDangerousSessionAuth,
);

const mutationRows = new Map<string, any>();

const poolQuery = jest.fn(async (sql: string, params: any[] = []) => {
  if (sql.includes("CREATE TABLE IF NOT EXISTS admin_support_mutations")) {
    return { rows: [] };
  }
  if (sql.includes("INSERT INTO admin_support_mutations")) {
    const [key, operation, accountId, hash, auditId] = params;
    if (mutationRows.has(key)) return { rows: [] };
    const row = {
      idempotency_key: key,
      operation,
      account_id: accountId,
      payload_hash: hash,
      audit_id: auditId,
      status: "reserved",
      updated_at: new Date(),
    };
    mutationRows.set(key, row);
    return { rows: [row] };
  }
  if (sql.includes("SELECT * FROM admin_support_mutations")) {
    const row = mutationRows.get(params[0]);
    return { rows: row ? [row] : [] };
  }
  if (sql.includes("UPDATE admin_support_mutations")) {
    if (sql.includes("SET audit_id=$2")) {
      const row = mutationRows.get(params[0]);
      if (!row || row.status !== "rejected") return { rows: [] };
      Object.assign(row, {
        audit_id: params[1],
        status: "reserved",
        error: null,
        updated_at: new Date(),
      });
      return { rows: [row] };
    }
    const [key, status, zendeskAuditId, zendeskJobId, safeResponse, error] =
      params;
    const row = mutationRows.get(key);
    if (row) {
      Object.assign(row, {
        status,
        zendesk_audit_id: zendeskAuditId ?? row.zendesk_audit_id,
        zendesk_job_id: zendeskJobId ?? row.zendesk_job_id,
        safe_response:
          safeResponse == null ? row.safe_response : JSON.parse(safeResponse),
        error,
        updated_at: new Date(),
      });
    }
    return { rows: [] };
  }
  throw new Error(`unexpected test SQL: ${sql}`);
});

const PROJECT_ID = "881e5f4d-fca6-4739-9848-45bfaa8d49d3";

function ticket(overrides: Record<string, unknown> = {}) {
  const now = new Date();
  return {
    id: 123,
    url: "https://example.zendesk.com/api/v2/tickets/123.json",
    status: "new",
    type: "problem",
    priority: "high",
    subject: "Project files unavailable for alice@example.com",
    description: `File listing is not showing; WebSocket error at https://cocalc.ai/projects/${PROJECT_ID}/files/home/alice/private.txt?token=secret\naccount_id=14a0013f-5cb5-45a0-9836-c94963076a87`,
    external_id: "14a0013f-5cb5-45a0-9836-c94963076a87",
    created_at: new Date(now.getTime() - 30 * 60_000).toISOString(),
    updated_at: new Date(now.getTime() - 10 * 60_000).toISOString(),
    requester_id: 44,
    assignee_id: 55,
    tags: ["support", "bug"],
    ...overrides,
  } as any;
}

describe("admin support API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin.mockResolvedValue(true);
    mockCentralLog.mockResolvedValue(undefined);
    mutationRows.clear();
    poolQuery.mockClear();
    mockGetPool.mockReturnValue({ query: poolQuery } as any);
    mockRequireDangerousSessionAuth.mockResolvedValue({} as any);
  });

  it("redacts common secrets and private project paths", () => {
    const redacted = redactSupportText(
      `alice@example.com from 192.0.2.10 password=hunter2 ` +
        `https://cocalc.ai/projects/${PROJECT_ID}/files/home/alice/private.txt?auth=x`,
      10_000,
    );
    expect(redacted).not.toContain("alice@example.com");
    expect(redacted).not.toContain("192.0.2.10");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain("private.txt");
    expect(redacted).toContain(PROJECT_ID);
    expect(redacted).toContain("[REDACTED_PATH]");
  });

  it("returns bounded redacted recent tickets and records an audit", async () => {
    const searchGet = jest.fn(async () => ({
      result: [ticket(), ticket({ id: 124, status: "solved" })],
      response: {},
    }));
    mockGetZendeskClient.mockResolvedValue({
      search: { get: searchGet },
    } as any);

    const result = await list({
      account_id: "admin-account",
      since_minutes: 60,
      limit: 25,
      statuses: ["new", "open"],
      reason: "investigate current support spike",
    });

    expect(result.tickets).toHaveLength(1);
    expect(result.tickets[0]).toMatchObject({
      id: 123,
      status: "new",
      project_ids: [PROJECT_ID],
      signals: {
        categories: expect.arrayContaining(["availability", "files"]),
        error_signatures: ["WEBSOCKET_ERROR"],
      },
    });
    expect(result.tickets[0].subject).not.toContain("alice@example.com");
    expect(result.tickets[0].description_preview).not.toContain("private.txt");
    expect(result.tickets[0].account_fingerprint).toMatch(
      /^account_[0-9a-f]+$/,
    );
    expect(JSON.stringify(result)).not.toContain(
      "14a0013f-5cb5-45a0-9836-c94963076a87",
    );
    expect(searchGet).toHaveBeenCalledWith([
      "search",
      expect.objectContaining({
        query: expect.stringContaining("type:ticket created>="),
        sort_by: "updated_at",
        sort_order: "desc",
      }),
    ]);
    expect(mockCentralLog).toHaveBeenCalledWith({
      event: "admin_support_operator",
      value: expect.objectContaining({
        account_id: "admin-account",
        mode: "list",
        reason: "investigate current support spike",
        result_count: 1,
      }),
    });
  });

  it("returns comments without requester identities or attachment URLs", async () => {
    const tickets = {
      show: jest.fn(async () => ({ result: ticket(), response: {} })),
      get: jest.fn(async () => ({
        result: [
          {
            id: 1,
            author_id: 44,
            public: true,
            created_at: new Date().toISOString(),
            plain_body: "Contact alice@example.com; api_key=super-secret",
            body: "ignored",
            attachments: [
              {
                size: 120,
                content_url:
                  "https://example.zendesk.com/attachments/private-token",
                file_name: "alice-private.txt",
              },
            ],
          },
        ],
        response: {},
      })),
    };
    mockGetZendeskClient.mockResolvedValue({ tickets } as any);

    const result = await show({
      account_id: "admin-account",
      ticket_id: 123,
      reason: "understand reported failure",
    });

    expect(result.comments).toEqual([
      expect.objectContaining({
        id: 1,
        author: "requester",
        attachment_count: 1,
        attachment_bytes: 120,
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("alice@example.com");
    expect(JSON.stringify(result)).not.toContain("super-secret");
    expect(JSON.stringify(result)).not.toContain("private-token");
    expect(JSON.stringify(result)).not.toContain("alice-private.txt");
    expect(tickets.get).toHaveBeenCalledWith([
      "tickets",
      123,
      "comments",
      { sort_order: "desc" },
    ]);
  });

  it("runs bounded ticket-only Zendesk searches", async () => {
    const searchGet = jest.fn(async () => ({
      result: [ticket()],
      response: {},
    }));
    mockGetZendeskClient.mockResolvedValue({
      search: { get: searchGet },
    } as any);

    const result = await search({
      account_id: "admin-account",
      query: "status<solved updated>2026-08-01",
      reason: "review unresolved tickets",
    });

    expect(result.query).toBe("type:ticket status<solved updated>2026-08-01");
    expect(result.tickets).toHaveLength(1);
    expect(searchGet).toHaveBeenCalledWith([
      "search",
      expect.objectContaining({
        query: "type:ticket status<solved updated>2026-08-01",
      }),
    ]);
    expect(mockCentralLog).toHaveBeenCalledWith({
      event: "admin_support_operator",
      value: expect.objectContaining({
        mode: "search",
        query_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    });
  });

  it("plans an update without mutating Zendesk", async () => {
    const current = ticket({ updated_at: "2026-08-05T12:00:00.000Z" });
    const tickets = {
      show: jest.fn(async () => ({ result: current, response: {} })),
      update: jest.fn(),
    };
    mockGetZendeskClient.mockResolvedValue({ tickets } as any);

    const result = await planUpdate({
      account_id: "admin-account",
      ticket_id: 123,
      public_reply: "Hello alice@example.com",
      status: "pending",
      reason: "response approved in support review",
    });

    expect(result).toMatchObject({
      operation: "update",
      commit: false,
      expected_updated_at: "2026-08-05T12:00:00.000Z",
      changes: {
        comment_kind: "public_reply",
        status: "pending",
      },
    });
    expect(result.changes.comment_preview).not.toContain("alice@example.com");
    expect(tickets.update).not.toHaveBeenCalled();
    expect(mockRequireDangerousSessionAuth).not.toHaveBeenCalled();
  });

  it("atomically updates a ticket and safely replays the request key", async () => {
    const before = ticket({
      updated_at: "2026-08-05T12:00:00.000Z",
      tags: ["support", "old"],
    });
    const after = ticket({
      updated_at: "2026-08-05T12:01:00.000Z",
      status: "pending",
      tags: ["support", "new"],
    });
    let showCalls = 0;
    const tickets = {
      show: jest.fn(async () => ({
        result: showCalls++ === 0 ? before : after,
        response: {},
      })),
      update: jest.fn(async () => ({
        result: after,
        response: {},
      })),
      get: jest.fn(async () => ({
        result: [
          {
            id: 765,
            author_id: 999,
            public: true,
            created_at: "2026-08-05T12:01:00.000Z",
            plain_body: "The issue is fixed.",
            body: "The issue is fixed.",
            attachments: [],
          },
        ],
        response: {},
      })),
    };
    const ticketaudits = {
      list: jest.fn(async () => [
        {
          id: 987,
          metadata: {
            custom: {
              cocalc_idempotency_key: "support-update-stable-key",
            },
          },
        },
      ]),
    };
    mockGetZendeskClient.mockResolvedValue({ tickets, ticketaudits } as any);
    const request = {
      account_id: "11111111-1111-4111-8111-111111111111",
      session_hash: "fresh-session",
      ticket_id: 123,
      public_reply: "The issue is fixed.",
      status: "pending" as const,
      add_tags: ["new"],
      remove_tags: ["old"],
      expected_updated_at: "2026-08-05T12:00:00.000Z",
      idempotency_key: "support-update-stable-key",
      reason: "approved response and status change",
    };

    const first = await update(request);
    const replay = await update(request);

    expect(mockRequireDangerousSessionAuth).toHaveBeenCalledWith(
      expect.objectContaining({
        account_id: request.account_id,
        session_hash: "fresh-session",
      }),
    );
    expect(tickets.update).toHaveBeenCalledTimes(1);
    expect(tickets.update).toHaveBeenCalledWith(123, {
      ticket: expect.objectContaining({
        safe_update: true,
        updated_stamp: request.expected_updated_at,
        status: "pending",
        tags: ["new", "support"],
        comment: { body: "The issue is fixed.", public: true },
        metadata: {
          custom: expect.objectContaining({
            cocalc_idempotency_key: request.idempotency_key,
          }),
        },
      }),
    });
    expect(first).toMatchObject({
      idempotent_replay: false,
      zendesk_audit_id: 987,
      comment: { id: 765, public: true },
      ticket: { status: "pending" },
    });
    expect(replay).toMatchObject({
      idempotent_replay: true,
      zendesk_audit_id: 987,
    });
  });

  it("does not retry an update whose remote outcome is indeterminate", async () => {
    const before = ticket({ updated_at: "2026-08-05T12:00:00.000Z" });
    const tickets = {
      show: jest.fn(async () => ({ result: before, response: {} })),
      update: jest.fn(async () => {
        throw new Error("connection reset after request was sent");
      }),
    };
    mockGetZendeskClient.mockResolvedValue({ tickets } as any);
    const request = {
      account_id: "11111111-1111-4111-8111-111111111111",
      session_hash: "fresh-session",
      ticket_id: 123,
      private_note: "Investigating.",
      expected_updated_at: "2026-08-05T12:00:00.000Z",
      idempotency_key: "support-update-indeterminate",
      reason: "approved internal note",
    };

    await expect(update(request)).rejects.toThrow(
      "connection reset after request was sent",
    );
    await expect(update(request)).rejects.toThrow("may have reached Zendesk");
    expect(tickets.update).toHaveBeenCalledTimes(1);
    expect(mutationRows.get(request.idempotency_key)?.status).toBe(
      "indeterminate",
    );
  });

  it("plans and commits a checked asynchronous merge", async () => {
    const targetBefore = ticket({
      id: 200,
      updated_at: "2026-08-05T13:00:00.000Z",
    });
    const sourceBefore = ticket({
      id: 201,
      updated_at: "2026-08-05T13:01:00.000Z",
    });
    const targetAfter = ticket({
      id: 200,
      updated_at: "2026-08-05T13:02:00.000Z",
    });
    const sourceAfter = ticket({
      id: 201,
      status: "closed",
      updated_at: "2026-08-05T13:02:00.000Z",
    });
    let committed = false;
    const tickets = {
      show: jest.fn(async (id: number) => ({
        result:
          id === 200
            ? committed
              ? targetAfter
              : targetBefore
            : committed
              ? sourceAfter
              : sourceBefore,
        response: {},
      })),
      merge: jest.fn(async () => {
        committed = true;
        return {
          result: { job_status: { id: "merge-job-1", status: "completed" } },
          response: {},
        };
      }),
    };
    mockGetZendeskClient.mockResolvedValue({ tickets } as any);

    const planned = await planMerge({
      account_id: "admin-account",
      target_ticket_id: 200,
      source_ticket_id: 201,
      target_comment: "Combining duplicate request.",
      reason: "duplicate tickets from same requester",
    });
    expect(planned).toMatchObject({
      commit: false,
      target_expected_updated_at: "2026-08-05T13:00:00.000Z",
      source_expected_updated_at: "2026-08-05T13:01:00.000Z",
    });

    const result = await merge({
      account_id: "11111111-1111-4111-8111-111111111111",
      session_hash: "fresh-session",
      target_ticket_id: 200,
      source_ticket_id: 201,
      target_comment: "Combining duplicate request.",
      target_expected_updated_at: planned.target_expected_updated_at,
      source_expected_updated_at: planned.source_expected_updated_at,
      idempotency_key: "support-merge-stable-key",
      reason: "duplicate tickets from same requester",
    });

    expect(tickets.merge).toHaveBeenCalledWith(200, {
      ids: [201],
      target_comment: "Combining duplicate request.",
      target_comment_is_public: false,
      source_comment_is_public: false,
    });
    expect(result).toMatchObject({
      zendesk_job_id: "merge-job-1",
      zendesk_job_status: "completed",
      source_ticket: { status: "closed" },
    });
  });

  it("rejects non-admin callers before reading Zendesk", async () => {
    mockIsAdmin.mockResolvedValue(false);
    await expect(
      list({
        account_id: "ordinary-account",
        reason: "should not work",
      }),
    ).rejects.toThrow("admin privileges required");
    expect(mockGetZendeskClient).not.toHaveBeenCalled();
  });

  it("groups repeated error signatures for incident triage", () => {
    const base = {
      agent_url: "ticket:1",
      status: "new" as const,
      type: "problem",
      subject: "Terminal unavailable",
      description_preview: "",
      created_at: "2026-07-13T00:00:00.000Z",
      updated_at: "2026-07-13T00:10:00.000Z",
      project_ids: [PROJECT_ID],
      signals: {
        categories: ["availability" as const, "terminal" as const],
        error_signatures: ["WEBSOCKET_ERROR"],
      },
    };
    const groups = buildTriageGroups([
      { id: 1, ...base },
      { id: 2, ...base, agent_url: "ticket:2" },
    ]);
    expect(groups).toEqual([
      expect.objectContaining({
        key: "error:WEBSOCKET_ERROR",
        reason: "error_signature",
        ticket_ids: [1, 2],
        count: 2,
        project_ids: [PROJECT_ID],
      }),
    ]);
  });
});
