/** @jest-environment jsdom */

import React from "react";
import { act, render } from "@testing-library/react";

const mockUseCodexLog = jest.fn();
const mockCodexActivity = jest.fn((_props: unknown) => null);
const mockDeleteActivityLog = jest.fn();
const mockDeleteAllActivityLogs = jest.fn();

jest.mock("../use-codex-log", () => ({
  useCodexLog: (options: unknown) => mockUseCodexLog(options),
}));

jest.mock("../codex-activity", () => ({
  __esModule: true,
  default: (props: unknown) => mockCodexActivity(props),
}));

jest.mock("../actions/activity-logs", () => ({
  deleteActivityLog: (...args: unknown[]) => mockDeleteActivityLog(...args),
  deleteAllActivityLogs: (...args: unknown[]) =>
    mockDeleteAllActivityLogs(...args),
}));

import { CodexLogPanel } from "../codex-log-panel";

describe("CodexLogPanel", () => {
  beforeEach(() => {
    mockUseCodexLog.mockReset();
    mockCodexActivity.mockReset();
    mockDeleteActivityLog.mockReset();
    mockDeleteAllActivityLogs.mockReset();
  });

  it("loads and prefers the full log when supplied events are only a preview", () => {
    const previewEvents = [
      { type: "event", event: { type: "message", text: "Working" }, seq: 1 },
    ];
    const fullEvents = [
      ...previewEvents,
      {
        type: "event",
        event: {
          type: "terminal",
          phase: "start",
          terminalId: "terminal-1",
          command: "pnpm test",
        },
        seq: 2,
      },
    ];
    mockUseCodexLog.mockReturnValue({
      events: fullEvents,
      deleteLog: jest.fn(),
    });

    render(
      <CodexLogPanel
        events={previewEvents as any}
        persistKey="project:chat:turn"
        logProjectId="project-1"
        logStore="acp-log/chat.chat"
        logKey="thread:turn"
        logEnabled
      />,
    );

    expect(mockUseCodexLog).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: true }),
    );
    expect(mockCodexActivity.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ events: fullEvents }),
    );
  });

  it("uses supplied preview events while the full log is loading", () => {
    const previewEvents = [
      { type: "event", event: { type: "message", text: "Working" }, seq: 1 },
    ];
    mockUseCodexLog.mockReturnValue({
      events: null,
      deleteLog: jest.fn(),
    });

    render(
      <CodexLogPanel
        events={previewEvents as any}
        persistKey="project:chat:turn"
        logProjectId="project-1"
        logStore="acp-log/chat.chat"
        logKey="thread:turn"
        logEnabled
      />,
    );

    expect(mockCodexActivity.mock.lastCall?.[0]).toEqual(
      expect.objectContaining({ events: previewEvents }),
    );
  });

  it("clears both full and preview hook state when deleting activity", async () => {
    const deleteFullLog = jest.fn().mockResolvedValue(undefined);
    const deletePreviewLog = jest.fn().mockResolvedValue(undefined);
    mockUseCodexLog.mockReturnValue({
      events: [],
      deleteLog: deleteFullLog,
    });
    mockDeleteActivityLog.mockImplementation(async ({ deleteLog }) => {
      await deleteLog?.();
    });

    render(
      <CodexLogPanel
        persistKey="project:chat:turn"
        logProjectId="project-1"
        logStore="acp-log/chat.chat"
        logKey="thread:turn"
        logEnabled
        activityContext={{ message: {} as any }}
        deleteLog={deletePreviewLog}
      />,
    );

    await act(async () => {
      await mockCodexActivity.mock.lastCall?.[0].onDeleteEvents();
    });

    expect(deleteFullLog).toHaveBeenCalledTimes(1);
    expect(deletePreviewLog).toHaveBeenCalledTimes(1);
  });

  it("clears current full and preview state after deleting all activity", async () => {
    const deleteFullLog = jest.fn().mockResolvedValue(undefined);
    const deletePreviewLog = jest.fn().mockResolvedValue(undefined);
    mockUseCodexLog.mockReturnValue({
      events: [],
      deleteLog: deleteFullLog,
    });
    mockDeleteAllActivityLogs.mockResolvedValue(undefined);
    const activityContext = { message: {} as any };

    render(
      <CodexLogPanel
        persistKey="project:chat:turn"
        logProjectId="project-1"
        logStore="acp-log/chat.chat"
        logKey="thread:turn"
        logEnabled
        activityContext={activityContext}
        deleteLog={deletePreviewLog}
      />,
    );

    await act(async () => {
      await mockCodexActivity.mock.lastCall?.[0].onDeleteAllEvents();
    });

    expect(mockDeleteAllActivityLogs).toHaveBeenCalledWith(activityContext);
    expect(deleteFullLog).toHaveBeenCalledTimes(1);
    expect(deletePreviewLog).toHaveBeenCalledTimes(1);
  });
});
