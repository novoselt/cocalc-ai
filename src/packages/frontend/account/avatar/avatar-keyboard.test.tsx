/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

/*
Clicking an avatar that has activity jumps to what that user is editing. That
interaction must also work from the keyboard, and only those avatars should
become tab stops -- avatars without activity (collaborator lists, chat) do
nothing when clicked, so making them focusable would add tab stops everywhere.
*/

import { fireEvent, render, screen } from "@testing-library/react";
import { Map as immutableMap } from "immutable";

const gotoUser = jest.fn();
const getEditorActions = jest.fn(() => ({ gotoUser }));

jest.mock("@cocalc/frontend/app-framework", () => ({
  React: require("react"),
  redux: {
    getStore: () => ({
      get_image: async () => undefined,
      get_color: async () => "#ffffff",
      get_name: () => "Ada Lovelace",
    }),
    getEditorActions: (...args: any[]) => getEditorActions(...(args as [])),
    // The tooltip renders a cursor line, which reads the project store.
    getProjectStore: () => ({ get_users_cursors: () => undefined }),
    getProjectActions: () => ({ goto_line: jest.fn() }),
  },
  useAsyncEffect: () => undefined,
  useTypedRedux: (_group: string, field: string) =>
    field === "user_map"
      ? immutableMap({})
      : field === "account_id"
        ? "me"
        : undefined,
}));

jest.mock("@cocalc/frontend/components", () => ({
  Gap: () => null,
  Tooltip: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

jest.mock("@cocalc/frontend/users/store", () => ({
  DEFAULT_COLOR: "rgb(170,170,170)",
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: { server_time: () => new Date() },
}));

jest.mock("@cocalc/frontend/projects/project-title", () => ({
  ProjectTitle: () => null,
}));

jest.mock("@cocalc/frontend/components/language-model-icon", () => ({
  LanguageModelVendorAvatar: () => null,
}));

import { Avatar } from "./avatar";

const project_id = "9a3d5f21-6c7b-4e18-8a2f-0d4c6b1e9f30";
const account_id = "1f2e3d4c-5b6a-4798-8899-aabbccddeeff";
const activity = { project_id, path: "a.md", last_used: new Date() };

describe("Avatar keyboard operability", () => {
  beforeEach(() => {
    gotoUser.mockClear();
    getEditorActions.mockClear();
  });

  it("activates the jump with Enter", () => {
    render(
      <Avatar
        account_id={account_id}
        project_id={project_id}
        path="a.md"
        activity={activity}
      />,
    );

    const avatar = screen.getByRole("button", { name: /Ada Lovelace/ });
    avatar.focus();
    expect(avatar).toHaveFocus();

    fireEvent.keyDown(avatar, { key: "Enter" });
    expect(gotoUser).toHaveBeenCalledWith(account_id);
  });

  it("activates the jump with Space", () => {
    render(
      <Avatar
        account_id={account_id}
        project_id={project_id}
        path="a.md"
        activity={activity}
      />,
    );

    const avatar = screen.getByRole("button", { name: /Ada Lovelace/ });
    avatar.focus();
    fireEvent.keyDown(avatar, { key: " " });

    expect(gotoUser).toHaveBeenCalledWith(account_id);
  });

  it("is not a tab stop when the avatar does not navigate anywhere", () => {
    render(<Avatar account_id={account_id} />);

    expect(screen.queryByRole("button")).toBeNull();
  });
});
