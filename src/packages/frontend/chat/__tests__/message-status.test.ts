/** @jest-environment jsdom */

import {
  codexActivityBlocksToSelectableMarkdown,
  computeAcpStateToRender,
  limitCodexActivityBlocks,
  shouldShowAcpResubmitToAgentButton,
} from "../message-state";

describe("codexActivityBlocksToSelectableMarkdown", () => {
  it("combines the visible activity window into one chronological document", () => {
    expect(
      codexActivityBlocksToSelectableMarkdown([
        { kind: "agent", text: "Inspecting the project." },
        {
          kind: "guidance",
          text: "Also check the tests.\nDo not deploy yet.",
          state: "sent",
        },
        { kind: "agent", text: "The focused tests pass." },
      ]),
    ).toBe(
      "Inspecting the project.\n\n" +
        "> **Guidance sent**\n>\n" +
        "> Also check the tests.\n> Do not deploy yet.\n\n" +
        "The focused tests pass.",
    );
  });
});

describe("limitCodexActivityBlocks", () => {
  const blocks = Array.from({ length: 250 }, (_, index) => ({
    kind: "agent" as const,
    text: `activity ${index}`,
  }));

  it("shows the newest capped window and reports hidden activity", () => {
    const result = limitCodexActivityBlocks(blocks, 100);
    expect(result.hiddenCount).toBe(150);
    expect(result.visibleBlocks).toHaveLength(100);
    expect(result.visibleBlocks[0].text).toBe("activity 150");
    expect(result.visibleBlocks[99].text).toBe("activity 249");
  });

  it("supports loading earlier activity in bounded pages", () => {
    const result = limitCodexActivityBlocks(blocks, 200);
    expect(result.hiddenCount).toBe(50);
    expect(result.visibleBlocks).toHaveLength(200);
    expect(result.visibleBlocks[0].text).toBe("activity 50");
  });
});

describe("computeAcpStateToRender", () => {
  it("hides queue state for non-viewer messages", () => {
    const state = computeAcpStateToRender({
      acpState: "queue",
      latestThreadInterrupted: false,
      isViewersMessage: false,
      generating: false,
    });
    expect(state).toBe("");
  });

  it("shows queue state for viewer messages", () => {
    const state = computeAcpStateToRender({
      acpState: "queue",
      latestThreadInterrupted: false,
      isViewersMessage: true,
      generating: false,
    });
    expect(state).toBe("queue");
  });

  it("shows pre-run sending states for viewer messages", () => {
    expect(
      computeAcpStateToRender({
        acpState: "sending",
        latestThreadInterrupted: false,
        isViewersMessage: true,
        generating: false,
      }),
    ).toBe("sending");
    expect(
      computeAcpStateToRender({
        acpState: "sent",
        latestThreadInterrupted: false,
        isViewersMessage: true,
        generating: false,
      }),
    ).toBe("sent");
  });

  it("shows running state for viewer messages until the assistant row exists", () => {
    expect(
      computeAcpStateToRender({
        acpState: "running",
        latestThreadInterrupted: false,
        isViewersMessage: true,
        generating: false,
        showViewerRunning: true,
      }),
    ).toBe("running");
  });

  it("hides running state for viewer messages after the assistant row exists", () => {
    expect(
      computeAcpStateToRender({
        acpState: "running",
        latestThreadInterrupted: false,
        isViewersMessage: true,
        generating: false,
        showViewerRunning: false,
      }),
    ).toBe("");
    expect(
      computeAcpStateToRender({
        acpState: "running",
        latestThreadInterrupted: false,
        isViewersMessage: true,
        generating: false,
        showViewerRunning: false,
      }),
    ).toBe("");
  });

  it("hides running state for non-viewer messages unless generating", () => {
    expect(
      computeAcpStateToRender({
        acpState: "running",
        latestThreadInterrupted: false,
        isViewersMessage: false,
        generating: false,
      }),
    ).toBe("");
    expect(
      computeAcpStateToRender({
        acpState: "running",
        latestThreadInterrupted: false,
        isViewersMessage: false,
        generating: true,
      }),
    ).toBe("running");
  });

  it("clears running state when the latest thread message is interrupted", () => {
    const state = computeAcpStateToRender({
      acpState: "running",
      latestThreadInterrupted: true,
      isViewersMessage: true,
      generating: true,
    });
    expect(state).toBe("");
  });
});

describe("shouldShowAcpResubmitToAgentButton", () => {
  const base = {
    hasActions: true,
    hasParentMessage: true,
    isViewersMessage: false,
    parentAcpState: "not-sent",
    readOnly: false,
    renderedValue: "Codex authentication expired.",
  };

  it("shows on assistant replies to failed frontend ACP submissions", () => {
    expect(shouldShowAcpResubmitToAgentButton(base)).toBe(true);
  });

  it("hides while the assistant turn is actively running", () => {
    expect(
      shouldShowAcpResubmitToAgentButton({
        ...base,
        isTurnRunning: true,
      }),
    ).toBe(false);
  });

  it("shows on active terminal thread errors without parent not-sent state", () => {
    expect(
      shouldShowAcpResubmitToAgentButton({
        ...base,
        parentAcpState: undefined,
        terminalThreadErrorActive: true,
      }),
    ).toBe(true);
  });

  it("hides without parent not-sent state or an active terminal thread error", () => {
    expect(
      shouldShowAcpResubmitToAgentButton({
        ...base,
        parentAcpState: "queue",
      }),
    ).toBe(false);
  });

  it("hides for viewer messages and read-only chats", () => {
    expect(
      shouldShowAcpResubmitToAgentButton({
        ...base,
        isViewersMessage: true,
      }),
    ).toBe(false);
    expect(
      shouldShowAcpResubmitToAgentButton({
        ...base,
        readOnly: true,
      }),
    ).toBe(false);
  });
});
