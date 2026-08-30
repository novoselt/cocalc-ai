/** @jest-environment jsdom */

import React from "react";
import { render } from "@testing-library/react";

const mockUseCodexLog = jest.fn();
const mockCodexActivity = jest.fn((_props: unknown) => null);

jest.mock("../use-codex-log", () => ({
  useCodexLog: (options: unknown) => mockUseCodexLog(options),
}));

jest.mock("../codex-activity", () => ({
  __esModule: true,
  default: (props: unknown) => mockCodexActivity(props),
}));

jest.mock("../actions/activity-logs", () => ({
  deleteActivityLog: jest.fn(),
  deleteAllActivityLogs: jest.fn(),
}));

import { CodexLogPanel } from "../codex-log-panel";

describe("CodexLogPanel", () => {
  beforeEach(() => {
    mockUseCodexLog.mockReset();
    mockCodexActivity.mockReset();
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
});
