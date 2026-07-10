/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool from "@cocalc/database/pool";
import centralLog from "@cocalc/database/postgres/central-log";
import isAdmin from "@cocalc/server/accounts/is-admin";
import { getRoutedHostControlClient } from "@cocalc/server/project-host/client";

import { describe as describeHost } from "./admin-host";

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("@cocalc/database/postgres/central-log", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("@cocalc/server/accounts/is-admin", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("@cocalc/server/project-host/client", () => ({
  getRoutedHostControlClient: jest.fn(),
}));

const mockGetPool = jest.mocked(getPool);
const mockCentralLog = jest.mocked(centralLog);
const mockIsAdmin = jest.mocked(isAdmin);
const mockGetRoutedHostControlClient = jest.mocked(getRoutedHostControlClient);

describe("admin host API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin.mockResolvedValue(true);
    mockCentralLog.mockResolvedValue(undefined);
  });

  it("counts project runtime state using the JSON state field", async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("FROM project_hosts")) {
        return {
          rows: [
            {
              id: "7843c648-86e4-45d3-9ed2-85ebe9faf9ee",
              name: "host",
              status: "running",
              last_seen: new Date("2026-07-08T19:00:00Z"),
              capacity: {},
              metadata: {},
            },
          ],
        };
      }
      if (sql.includes("FROM projects")) {
        return {
          rows: [
            {
              total: 3,
              running: 1,
              stopped: 2,
              provisioned: 3,
              not_provisioned: 0,
            },
          ],
        };
      }
      if (sql.includes("FROM long_running_operations")) {
        return { rows: [] };
      }
      if (sql.includes("FROM project_host_availability_events")) {
        return { rows: [] };
      }
      throw new Error(`unexpected query: ${sql}`);
    });
    mockGetPool.mockReturnValue({ query } as any);

    const result = await describeHost({
      account_id: "account-id",
      host_id: "7843c648-86e4-45d3-9ed2-85ebe9faf9ee",
      include_live: false,
      reason: "test",
    });

    const projectCountSql = query.mock.calls
      .map(([sql]) => sql)
      .find((sql) => `${sql}`.includes("FROM projects"));
    expect(projectCountSql).toContain("state->>'state'");
    expect(projectCountSql).not.toContain("WHERE state='running'");
    expect(result.project_counts).toMatchObject({ running: 1, stopped: 2 });
    expect(mockGetRoutedHostControlClient).not.toHaveBeenCalled();
  });
});
