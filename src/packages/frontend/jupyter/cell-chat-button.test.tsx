/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";

const mockUseAnchoredThreads = jest.fn();
const mockOpenAnchorChat = jest.fn();
const mockOpenAnchorChatThread = jest.fn();

jest.mock("@cocalc/frontend/chat/anchors", () => ({
  useAnchoredThreads: (...args) => mockUseAnchoredThreads(...args),
}));

jest.mock("@cocalc/frontend/frame-editors/frame-tree/frame-context", () => ({
  useFrameContext: () => ({
    project_id: "project-1",
    path: "notebook.ipynb",
    actions: {
      openAnchorChat: mockOpenAnchorChat,
      openAnchorChatThread: mockOpenAnchorChatThread,
    },
  }),
}));

jest.mock("@cocalc/frontend/components", () => ({
  Icon: ({ name }) => <span>{name}</span>,
  Tooltip: ({ children }) => <>{children}</>,
}));

jest.mock("antd", () => ({
  Badge: ({ children, color, count }) => (
    <span data-testid="badge" data-color={color}>
      {children}
      {count > 0 ? <span>{count}</span> : null}
    </span>
  ),
  Button: ({ children, onClick, ...props }) => (
    <button onClick={onClick} {...props}>
      {children}
    </button>
  ),
  Dropdown: {
    Button: ({ children }) => <div>{children}</div>,
  },
}));

import { CellChatCompactButton } from "./cell-chat-button";

describe("CellChatCompactButton", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseAnchoredThreads.mockReturnValue({
      threads: [],
      totalMessages: 0,
      totalUnread: 0,
    });
  });

  it("stays hidden on an untouched, unselected cell", () => {
    const { container } = render(<CellChatCompactButton cellId="cell-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps a read discussion visible after hover ends", () => {
    mockUseAnchoredThreads.mockReturnValue({
      threads: [{ key: "thread-1", unreadCount: 0 }],
      totalMessages: 3,
      totalUnread: 0,
    });

    render(<CellChatCompactButton cellId="cell-1" />);

    expect(
      screen.getByRole("button", {
        name: "Discuss this cell in side chat",
      }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("badge")).toHaveTextContent("3");
  });

  it("keeps chat discoverable on a selected cell with no discussion", () => {
    render(<CellChatCompactButton cellId="cell-1" showIdleButton />);
    expect(screen.getByRole("button")).toHaveTextContent("Chat");
  });

  it("opens the newest unread thread", () => {
    mockUseAnchoredThreads.mockReturnValue({
      threads: [{ key: "thread-2", unreadCount: 2 }],
      totalMessages: 4,
      totalUnread: 2,
    });

    render(<CellChatCompactButton cellId="cell-1" />);
    fireEvent.click(screen.getByRole("button"));

    expect(mockOpenAnchorChatThread).toHaveBeenCalledWith("thread-2");
    expect(mockOpenAnchorChat).not.toHaveBeenCalled();
  });
});
