/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import centralLog from "@cocalc/database/postgres/central-log";
import isAdmin from "@cocalc/server/accounts/is-admin";
import { listConfiguredBays } from "@cocalc/server/bay-directory";
import { getInterBayBridge } from "@cocalc/server/inter-bay/bridge";
import {
  readWebappCrashesLocal,
  setWebappCrashResolutionLocal,
} from "@cocalc/server/webapp-crashes";
import { requireDangerousSessionAuth } from "./dangerous-session-auth";

import { buildCrashTriageGroups, list, resolve } from "./admin-crashes";

jest.mock("@cocalc/database/postgres/central-log", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("@cocalc/server/accounts/is-admin", () => ({
  __esModule: true,
  default: jest.fn(),
}));
jest.mock("@cocalc/server/bay-config", () => ({
  getConfiguredBayId: () => "bay-0",
}));
jest.mock("@cocalc/server/bay-directory", () => ({
  listConfiguredBays: jest.fn(),
}));
jest.mock("@cocalc/server/inter-bay/bridge", () => ({
  getInterBayBridge: jest.fn(),
}));
jest.mock("@cocalc/server/webapp-crashes", () => ({
  readWebappCrashesLocal: jest.fn(),
  setWebappCrashResolutionLocal: jest.fn(),
}));
jest.mock("./dangerous-session-auth", () => ({
  requireDangerousSessionAuth: jest.fn(),
}));

const mockCentralLog = jest.mocked(centralLog);
const mockIsAdmin = jest.mocked(isAdmin);
const mockListConfiguredBays = jest.mocked(listConfiguredBays);
const mockGetInterBayBridge = jest.mocked(getInterBayBridge);
const mockReadLocal = jest.mocked(readWebappCrashesLocal);
const mockSetResolutionLocal = jest.mocked(setWebappCrashResolutionLocal);
const mockRequireDangerousSessionAuth = jest.mocked(
  requireDangerousSessionAuth,
);

const REPORT_ID = "11111111-1111-4111-8111-111111111111";

function report(overrides: Record<string, unknown> = {}) {
  return {
    id: REPORT_ID,
    bay_id: "bay-0",
    time: "2026-07-23T01:00:00.000Z",
    name: "TypeError",
    message: "undefined is not an object",
    severity: "error",
    signature: "crash_0123456789abcdef",
    signature_label: "TypeError: undefined is not an object",
    build_key: "rev:abc",
    smc_git_rev: "abc",
    smc_version: "1",
    build_date: "2026-07-23",
    browser: "chrome",
    mobile: false,
    responsive: true,
    path: "https://cocalc.ai/projects/id/[REDACTED_PATH]",
    file: "app.js",
    line_number: 1,
    column_number: 2,
    account_fingerprint: "account_1",
    resolution: null,
    comment: "",
    stacktrace: "",
    user_agent: "",
    uptime: "",
    start_time: null,
    ...overrides,
  } as any;
}

describe("admin crashes API", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAdmin.mockResolvedValue(true);
    mockCentralLog.mockResolvedValue(undefined);
    mockRequireDangerousSessionAuth.mockResolvedValue({} as any);
    mockListConfiguredBays.mockResolvedValue([
      { bay_id: "bay-0" },
      { bay_id: "bay-1" },
    ] as any);
  });

  it("aggregates bounded crash reports across bays and preserves bay failures", async () => {
    mockReadLocal.mockResolvedValue({
      bay_id: "bay-0",
      reports: [report()],
      source_candidates: 1,
      truncated: false,
    });
    mockGetInterBayBridge.mockReturnValue({
      bayOps: () => ({
        getWebappCrashes: async () => {
          throw new Error("bay unavailable");
        },
      }),
    } as any);

    const result = await list({
      account_id: "admin-account",
      since_minutes: 60,
      reason: "investigate crash spike",
    });

    expect(result.reports).toHaveLength(1);
    expect(result.queried_bays).toEqual(["bay-0", "bay-1"]);
    expect(result.bay_errors).toEqual([
      { bay_id: "bay-1", error: "bay unavailable" },
    ]);
    expect(mockCentralLog).toHaveBeenCalledWith({
      event: "admin_crash_operator",
      value: expect.objectContaining({
        mode: "list",
        reason: "investigate crash spike",
        result_count: 1,
      }),
    });
  });

  it("rejects non-admin callers before querying any bay", async () => {
    mockIsAdmin.mockResolvedValue(false);
    await expect(
      list({ account_id: "ordinary-account", reason: "should fail" }),
    ).rejects.toThrow("admin privileges required");
    expect(mockReadLocal).not.toHaveBeenCalled();
  });

  it("groups identical signature/build crashes across bays and accounts", () => {
    const groups = buildCrashTriageGroups([
      report(),
      report({
        id: "22222222-2222-4222-8222-222222222222",
        bay_id: "bay-1",
        account_fingerprint: "account_2",
      }),
    ]);
    expect(groups).toEqual([
      expect.objectContaining({
        key: "crash_0123456789abcdef:rev:abc",
        count: 2,
        distinct_accounts: 2,
        bay_ids: ["bay-0", "bay-1"],
        status: "open",
      }),
    ]);
  });

  it("requires fresh auth and updates a signature/build resolution", async () => {
    mockSetResolutionLocal.mockResolvedValue({
      report_id: REPORT_ID,
      signature: "crash_0123456789abcdef",
      build_key: "rev:abc",
      resolution: {
        status: "solved",
        report_id: REPORT_ID,
        resolved_at: "2026-07-23T02:00:00.000Z",
        resolved_by_fingerprint: "account_admin",
        note: "fixed",
      },
    });
    mockReadLocal.mockResolvedValue({
      bay_id: "bay-0",
      reports: [report()],
      source_candidates: 1,
      truncated: false,
    });
    mockGetInterBayBridge.mockReturnValue({
      bayOps: () => ({
        setWebappCrashResolution: async () => ({
          report_id: REPORT_ID,
          signature: "crash_0123456789abcdef",
          build_key: "rev:abc",
          resolution: {
            status: "solved",
            report_id: REPORT_ID,
            resolved_at: "2026-07-23T02:00:00.000Z",
            resolved_by_fingerprint: "account_admin",
            note: "fixed",
          },
        }),
      }),
    } as any);

    const result = await resolve({
      account_id: "22222222-2222-4222-8222-222222222222",
      session_hash: "fresh-session",
      report_id: REPORT_ID,
      bay_id: "bay-0",
      note: "fixed",
      reason: "verified frontend fix",
    });

    expect(mockRequireDangerousSessionAuth).toHaveBeenCalledWith(
      expect.objectContaining({ session_hash: "fresh-session" }),
    );
    expect(mockSetResolutionLocal).toHaveBeenCalledWith({
      report_id: REPORT_ID,
      solved: true,
      actor_account_id: "22222222-2222-4222-8222-222222222222",
      note: "fixed",
      signature: "crash_0123456789abcdef",
      build_key: "rev:abc",
    });
    expect(result.resolution).toMatchObject({ status: "solved" });
    expect(result.updated_bays).toEqual(["bay-0", "bay-1"]);
  });
});
