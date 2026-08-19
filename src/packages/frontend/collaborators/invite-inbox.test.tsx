/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import {
  IncomingInvitesNotificationSection,
  type InviteInboxState,
} from "./invite-inbox";

const ensureRealtimeFeedForCurrentAccount = jest.fn(async () => undefined);
const openProject = jest.fn(async () => undefined);
const listInvites = jest.fn(async () => []);

jest.mock("@cocalc/frontend/app-framework", () => {
  const React = require("react");
  return {
    React,
    redux: {
      getActions: (name: string) => {
        if (name === "projects") {
          return {
            ensureRealtimeFeedForCurrentAccount,
            open_project: openProject,
          };
        }
        return {};
      },
    },
    useCallback: React.useCallback,
    useEffect: React.useEffect,
    useMemo: React.useMemo,
    useState: React.useState,
    useProjectMapField: jest.fn(() => "owner"),
    useTypedRedux: jest.fn(() => "account-1"),
  };
});

jest.mock("@cocalc/frontend/components", () => ({
  Icon: ({ name }: any) => <span>{name}</span>,
  Loading: () => <span>Loading</span>,
  Markdown: ({ value }: any) => <span>{value}</span>,
  Paragraph: ({ children }: any) => <p>{children}</p>,
  SettingBox: ({ children, title }: any) => (
    <section>
      <header>{title}</header>
      {children}
    </section>
  ),
  TimeAgo: () => <span>time</span>,
}));

jest.mock("./invite-count", () => ({
  setUnreadIncomingInviteCount: jest.fn(),
}));

jest.mock("./invite-events", () => ({
  notifyCollabInvitesChanged: jest.fn(),
  onCollabInvitesChanged: jest.fn(() => jest.fn()),
}));

jest.mock("./viewer-read-policy", () => ({
  viewerReadPolicySummary: () => "All files",
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    project_collaborators: {
      list_invites: (...args: any[]) => listInvites(...args),
      list_invite_blocks: jest.fn(async () => []),
      respond_invite: jest.fn(async () => undefined),
    },
  },
}));

describe("IncomingInvitesNotificationSection", () => {
  beforeEach(() => {
    ensureRealtimeFeedForCurrentAccount.mockClear();
    openProject.mockClear();
  });

  it("keeps accepted invite feedback visible with an open project action", async () => {
    const respond = jest.fn(async () => true);
    const state: InviteInboxState = {
      loading: false,
      error: "",
      busy: "",
      incoming: [
        {
          invite_id: "invite-1",
          project_id: "project-1",
          project_title: "Demo Project",
          inviter_account_id: "inviter-1",
          inviter_name: "Grace Hopper",
          invite_role: "collaborator",
          created: new Date("2026-05-30T00:00:00.000Z"),
        } as any,
      ],
      outgoing: [],
      blocks: [],
      load: jest.fn(async () => undefined),
      respond,
      copyInviteLink: jest.fn(async () => undefined),
      unblock: jest.fn(async () => undefined),
    };

    render(<IncomingInvitesNotificationSection state={state} />);

    fireEvent.click(screen.getByText("Accept"));

    await waitFor(() =>
      expect(respond).toHaveBeenCalledWith("invite-1", "accept"),
    );
    expect(await screen.findByText("Joined Demo Project")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Open project"));

    await waitFor(() =>
      expect(openProject).toHaveBeenCalledWith({
        project_id: "project-1",
        target: "files",
        switch_to: true,
        restore_session: false,
      }),
    );
    expect(ensureRealtimeFeedForCurrentAccount).toHaveBeenCalled();
  });
});

describe("InviteInboxPanel outgoing email delivery", () => {
  beforeEach(() => {
    listInvites.mockReset();
  });

  it("requires manual link delivery when no email was sent", async () => {
    listInvites.mockImplementation(async ({ direction }) =>
      direction === "all"
        ? [
            {
              invite_id: "invite-manual",
              project_id: "project-1",
              project_title: "Demo Project",
              inviter_account_id: "account-1",
              invite_source: "email",
              target_email: "student@example.com",
              status: "pending",
              created: new Date("2026-08-19T00:00:00.000Z"),
              last_sent: null,
            },
          ]
        : [],
    );

    const { InviteInboxPanel } = await import("./invite-inbox");
    render(
      <InviteInboxPanel project_id="project-1" mode="project" showWhenEmpty />,
    );

    fireEvent.click(
      await screen.findByRole("button", { name: /pending invitations/i }),
    );
    expect(
      await screen.findByRole("status", {
        name: /invitation email delivery status/i,
      }),
    ).toHaveTextContent(/must use copy link/i);
    expect(
      screen.getByRole("button", { name: /copy link/i }),
    ).toBeInTheDocument();
    expect(screen.getByText(/invite created/i)).toBeInTheDocument();
    expect(screen.queryByText(/^sent/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /basic membership/i }),
    ).toHaveAttribute("href", expect.stringMatching(/settings\/membership/));
  });
});
