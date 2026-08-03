import immutable from "immutable";
import { COLORS } from "@cocalc/util/theme";
import {
  openArchivedThread,
  resolveThreadStatusDot,
} from "../chatroom-sidebar";

describe("resolveThreadStatusDot", () => {
  const baseThread = {
    key: "thread-1",
    label: "Thread 1",
    displayLabel: "Thread 1",
    newestTime: 1000,
    messageCount: 1,
    hasCustomName: false,
    hasCustomAppearance: false,
    readCount: 0,
    unreadCount: 0,
    isAI: true,
    isPinned: false,
    isArchived: false,
  } as any;

  it("shows a codex-active dot when ACP marks the thread running", () => {
    expect(
      resolveThreadStatusDot({
        thread: baseThread,
        activityNow: 10_000,
        acpState: immutable
          .Map<string, string>()
          .set("thread:thread-1", "running"),
      }),
    ).toEqual({
      showDot: true,
      dotColor: COLORS.RUN,
      dotTitle: "Codex active",
    });
  });

  it("falls back to recent activity when no ACP state is active", () => {
    expect(
      resolveThreadStatusDot({
        thread: {
          ...baseThread,
          lastActivityAt: 9_000,
        },
        activityNow: 10_000,
        acpState: immutable.Map<string, string>(),
      }),
    ).toEqual({
      showDot: true,
      dotColor: COLORS.BLUE,
      dotTitle: "Recent activity",
    });
  });

  it("prefers codex-active over recent-activity dots", () => {
    expect(
      resolveThreadStatusDot({
        thread: {
          ...baseThread,
          lastActivityAt: 9_900,
        },
        activityNow: 10_000,
        acpState: immutable
          .Map<string, string>()
          .set("thread:thread-1", "queue"),
      }),
    ).toEqual({
      showDot: true,
      dotColor: COLORS.RUN,
      dotTitle: "Codex active",
    });
  });
});

describe("openArchivedThread", () => {
  it("selects an archived thread and closes the archive dialog", () => {
    const setSelectedThreadKey = jest.fn();
    const setAllowAutoSelectThread = jest.fn();
    const setArchivedOpen = jest.fn();
    const setSidebarVisible = jest.fn();

    openArchivedThread({
      threadKey: "resolved-thread",
      isCompact: false,
      setSelectedThreadKey,
      setAllowAutoSelectThread,
      setArchivedOpen,
      setSidebarVisible,
    });

    expect(setAllowAutoSelectThread).toHaveBeenCalledWith(false);
    expect(setSelectedThreadKey).toHaveBeenCalledWith("resolved-thread");
    expect(setArchivedOpen).toHaveBeenCalledWith(false);
    expect(setSidebarVisible).not.toHaveBeenCalled();
  });

  it("also closes the sidebar in compact mode", () => {
    const setSidebarVisible = jest.fn();
    openArchivedThread({
      threadKey: "resolved-thread",
      isCompact: true,
      setSelectedThreadKey: jest.fn(),
      setAllowAutoSelectThread: jest.fn(),
      setArchivedOpen: jest.fn(),
      setSidebarVisible,
    });
    expect(setSidebarVisible).toHaveBeenCalledWith(false);
  });
});
