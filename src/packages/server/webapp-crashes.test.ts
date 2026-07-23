/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getPool from "@cocalc/database/pool";

import {
  crashBuildKey,
  crashSignature,
  readWebappCrashesLocal,
  redactCrashText,
  setWebappCrashResolutionLocal,
} from "./webapp-crashes";

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("@cocalc/server/bay-config", () => ({
  getConfiguredBayId: () => "bay-test",
}));

const mockGetPool = jest.mocked(getPool);
const REPORT_ID = "11111111-1111-4111-8111-111111111111";
const ADMIN_ID = "22222222-2222-4222-8222-222222222222";

function crashRow(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    account_id: "33333333-3333-4333-8333-333333333333",
    name: "TypeError",
    message: "Cannot read properties of undefined (reading 'map')",
    comment: "contact alice@example.com password=hunter2",
    stacktrace:
      "TypeError: Cannot read properties of undefined\n    at renderList (https://cocalc.ai/static/app.abc123.js:42:7)",
    file: "https://cocalc.ai/static/app.abc123.js?token=secret",
    line_number: 42,
    column_number: 7,
    severity: "error",
    browser: "chrome",
    mobile: false,
    responsive: true,
    user_agent: "Mozilla/5.0 alice@example.com",
    path: "https://cocalc.ai/projects/881e5f4d-fca6-4739-9848-45bfaa8d49d3/files/home/alice/private.txt?token=secret",
    smc_version: "1.2.3",
    build_date: "2026-07-23",
    smc_git_rev: "abcdef123456",
    uptime: "120",
    start_time: new Date("2026-07-23T00:00:00Z"),
    time: new Date("2026-07-23T01:00:00Z"),
    ...overrides,
  };
}

describe("webapp crash diagnostics", () => {
  beforeEach(() => jest.clearAllMocks());

  it("creates stable signatures while ignoring volatile identifiers", () => {
    const first = crashSignature({
      name: "TypeError",
      message: `project ${REPORT_ID} failed after 1234567 ms`,
      stacktrace: "TypeError\n at open (https://cocalc.ai/app.js?x=1)",
    });
    const second = crashSignature({
      name: "TypeError",
      message:
        "project 99999999-9999-4999-8999-999999999999 failed after 7654321 ms",
      stacktrace: "TypeError\n at open (https://staging.cocalc.ai/app.js?x=2)",
    });
    expect(first.signature).toBe(second.signature);
    expect(first.signature).toMatch(/^crash_[0-9a-f]{16}$/);
  });

  it("redacts secrets, identities, and private project paths", () => {
    const redacted = redactCrashText(
      `alice@example.com password=hunter2 account_id=${ADMIN_ID} https://cocalc.ai/projects/${REPORT_ID}/files/home/alice/private.txt?auth=x`,
      10_000,
    );
    expect(redacted).not.toContain("alice@example.com");
    expect(redacted).not.toContain("hunter2");
    expect(redacted).not.toContain(ADMIN_ID);
    expect(redacted).not.toContain("private.txt");
    expect(redacted).toContain("[REDACTED_PATH]");
  });

  it("returns redacted reports and joins signature/build resolution state", async () => {
    const row = crashRow();
    const signature = crashSignature(row).signature;
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({
        rows: [
          {
            signature,
            build_key: "rev:abcdef123456",
            status: "solved",
            report_id: REPORT_ID,
            resolved_by: ADMIN_ID,
            note: "fixed in deployment",
            resolved_at: new Date("2026-07-23T02:00:00Z"),
          },
        ],
      });
    mockGetPool.mockReturnValue({ query } as any);

    const result = await readWebappCrashesLocal({
      status: "all",
      include_details: true,
    });

    expect(result.bay_id).toBe("bay-test");
    expect(result.reports[0]).toMatchObject({
      id: REPORT_ID,
      build_key: "rev:abcdef123456",
      signature,
      resolution: { status: "solved", note: "fixed in deployment" },
    });
    expect(JSON.stringify(result)).not.toContain("alice@example.com");
    expect(JSON.stringify(result)).not.toContain("hunter2");
    expect(JSON.stringify(result)).not.toContain("private.txt");
    expect(crashBuildKey(row)).toBe("rev:abcdef123456");
  });

  it("upserts a signature/build resolution and returns the refreshed report", async () => {
    const row = crashRow();
    const signature = crashSignature(row).signature;
    let resolutionWritten = false;
    const query = jest.fn(async (sql: string) => {
      if (sql.includes("INSERT INTO webapp_error_resolutions")) {
        resolutionWritten = true;
        return {
          rows: [
            {
              signature,
              build_key: "rev:abcdef123456",
              status: "solved",
              report_id: REPORT_ID,
              resolved_by: ADMIN_ID,
              note: "fixed",
              resolved_at: new Date("2026-07-23T02:00:00Z"),
            },
          ],
        };
      }
      if (sql.includes("FROM webapp_error_resolutions")) {
        return {
          rows: resolutionWritten
            ? [
                {
                  signature,
                  build_key: "rev:abcdef123456",
                  status: "solved",
                  report_id: REPORT_ID,
                  resolved_by: ADMIN_ID,
                  note: "fixed",
                  resolved_at: new Date("2026-07-23T02:00:00Z"),
                },
              ]
            : [],
        };
      }
      return { rows: [row] };
    });
    mockGetPool.mockReturnValue({ query } as any);

    const report = await setWebappCrashResolutionLocal({
      report_id: REPORT_ID,
      solved: true,
      actor_account_id: ADMIN_ID,
      note: "fixed",
    });

    expect(resolutionWritten).toBe(true);
    expect(report.resolution).toMatchObject({
      status: "solved",
      note: "fixed",
    });
  });
});
