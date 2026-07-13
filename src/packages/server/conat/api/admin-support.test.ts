/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import centralLog from "@cocalc/database/postgres/central-log";
import isAdmin from "@cocalc/server/accounts/is-admin";
import getZendeskClient from "@cocalc/server/support/zendesk-client";

import {
  buildTriageGroups,
  list,
  redactSupportText,
  show,
} from "./admin-support";

jest.mock("@cocalc/database/postgres/central-log", () => ({
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

const mockCentralLog = jest.mocked(centralLog);
const mockIsAdmin = jest.mocked(isAdmin);
const mockGetZendeskClient = jest.mocked(getZendeskClient);

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
    ...overrides,
  } as any;
}

describe("admin support API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin.mockResolvedValue(true);
    mockCentralLog.mockResolvedValue(undefined);
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
