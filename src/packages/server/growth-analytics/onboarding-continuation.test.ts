/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

const queryMock = jest.fn();
const createNotificationEventGraphMock = jest.fn();

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: () => ({ query: (...args: unknown[]) => queryMock(...args) }),
}));

jest.mock("@cocalc/database/postgres/notifications-core", () => ({
  createNotificationEventGraph: (...args: unknown[]) =>
    createNotificationEventGraphMock(...args),
}));

import { continuationArtifact, __test__ } from "./onboarding-continuation";

const continuation = {
  account_id: "11111111-1111-4111-8111-111111111111",
  home_bay_id: "bay-0",
  project_id: "22222222-2222-4222-8222-222222222222",
  onboarding_path: "jupyter-python",
  notification_event_id: "33333333-3333-4333-8333-333333333333",
  notification_id: "44444444-4444-4444-8444-444444444444",
  attempt_count: 1,
};

describe("onboarding continuation", () => {
  beforeEach(() => {
    queryMock.mockReset();
    createNotificationEventGraphMock.mockReset();
  });
  it.each([
    ["jupyter-python", "Welcome.ipynb"],
    ["sage", "Welcome.ipynb"],
    ["code", "Terminal.term"],
    ["latex", "document.tex"],
    ["teaching", "Course.course"],
    ["codex", undefined],
  ])("maps %s to its starter artifact", (path, expected) => {
    expect(continuationArtifact(path)).toBe(expected);
  });

  it("deep-links to the starter artifact", () => {
    expect(__test__.continuationTarget("project-id", "latex")).toBe(
      "/projects/project-id/files/document.tex",
    );
    expect(__test__.continuationTarget("project-id", "codex")).toBe(
      "/projects/project-id/files/",
    );
  });

  it("suppresses unsafe and unnecessary reminders", () => {
    const eligible = {
      account_exists: true,
      banned: false,
      project_exists: true,
      project_access: true,
      returned: false,
    };
    expect(__test__.suppressionReason(eligible)).toBeUndefined();
    expect(__test__.suppressionReason({ ...eligible, banned: true })).toBe(
      "account-banned",
    );
    expect(__test__.suppressionReason({ ...eligible, returned: true })).toBe(
      "already-returned",
    );
  });

  it("uses stable ids and status-delivery metadata", async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 0, rows: [] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });
    createNotificationEventGraphMock.mockResolvedValue({});

    await __test__.emitContinuation(continuation);

    expect(createNotificationEventGraphMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_id: continuation.notification_event_id,
        targets: [
          expect.objectContaining({
            notification_id: continuation.notification_id,
            dedupe_key: `onboarding-day-one:${continuation.account_id}`,
            summary_json: expect.objectContaining({
              notice_type: "onboarding_day_one",
              action_link: expect.stringContaining("Welcome.ipynb"),
            }),
          }),
        ],
      }),
    );
  });

  it("converges after a crash without emitting a duplicate", async () => {
    queryMock
      .mockResolvedValueOnce({ rowCount: 1, rows: [{ exists: 1 }] })
      .mockResolvedValueOnce({ rowCount: 1, rows: [] });

    await __test__.emitContinuation(continuation);

    expect(createNotificationEventGraphMock).not.toHaveBeenCalled();
    expect(queryMock.mock.calls[1][0]).toContain("status='sent'");
  });
});
