/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { fromJS } from "immutable";

import { ProjectActionsMenu } from "./projects-actions-menu";

const moveProjectToHost = jest.fn();
const refreshProjectRegion = jest.fn(async () => undefined);
const runFreshAuthAction = jest.fn();
const protectedActions: Array<() => Promise<void>> = [];

jest.mock("antd", () => {
  const React = require("react");
  return {
    Dropdown: ({ children, menu }: any) => (
      <div>
        {children}
        <button
          type="button"
          onClick={() =>
            menu.onClick({
              key: "move",
              domEvent: { stopPropagation: jest.fn() },
            })
          }
        >
          Move to host…
        </button>
      </div>
    ),
    Modal: {
      error: jest.fn(),
    },
  };
});

jest.mock("react-intl", () => ({
  useIntl: () => ({
    formatMessage: (message: { defaultMessage?: string; id?: string }) =>
      message.defaultMessage ?? message.id ?? "Project",
  }),
}));

jest.mock("@cocalc/frontend/app-framework", () => ({
  redux: {
    getActions: () => ({ close_project_tab: jest.fn() }),
    getProjectActions: () => ({ refresh_project_log: jest.fn() }),
  },
  useActions: () => ({
    archive_project: jest.fn(),
    move_project_to_host: moveProjectToHost,
    open_project: jest.fn(),
    toggle_hide_project: jest.fn(),
  }),
  useTypedRedux: (store: string | { project_id: string }, key: string) => {
    if (store === "account" && key === "account_id") return "account-1";
    if (store === "account" && key === "is_admin") return false;
    if (store === "projects" && key === "project_map") {
      return fromJS({
        "project-1": {
          host_id: "host-1",
          users: { "account-1": { group: "owner" } },
        },
      });
    }
    if (typeof store === "object" && key === "project_log") return fromJS([]);
    return undefined;
  },
}));

jest.mock("@cocalc/frontend/auth/fresh-auth", () => ({
  FreshAuthModal: ({ open }: { open: boolean }) => (
    <div data-testid="fresh-auth-modal" data-open={String(open)} />
  ),
  useFreshAuthAction: () => ({
    runFreshAuthAction,
    freshAuthModalProps: {
      open: false,
      onCancel: jest.fn(),
      onSuccess: jest.fn(),
    },
  }),
}));

jest.mock("@cocalc/frontend/components", () => ({
  Icon: ({ name }: { name: string }) => <span>{name}</span>,
}));

jest.mock("@cocalc/frontend/i18n", () => ({
  labels: {
    explorer: { defaultMessage: "Explorer" },
    new: { defaultMessage: "New" },
    project: { defaultMessage: "Project" },
    recent_files: { defaultMessage: "Recent Files" },
  },
}));

jest.mock("@cocalc/frontend/project/page/file-tab", () => ({
  FIXED_PROJECT_TABS: {
    files: { icon: "folder" },
    log: { icon: "history" },
    new: { icon: "plus" },
    settings: { icon: "cog" },
  },
}));

jest.mock("@cocalc/frontend/project/page/flyouts/store", () => ({
  useStarredFilesManager: () => ({ starred: [] }),
}));

jest.mock("@cocalc/frontend/project/use-project-region", () => ({
  useProjectRegion: () => ({
    region: "us",
    refresh: refreshProjectRegion,
  }),
}));

jest.mock("@cocalc/frontend/hosts/pick-host", () => ({
  HostPickerModal: ({ open, onSelect }: any) =>
    open ? (
      <button
        type="button"
        onClick={() => onSelect("host-2", { region: "europe-west1" })}
      >
        Select destination
      </button>
    ) : null,
}));

jest.mock("./archive-project-modal", () => ({
  ArchiveProjectModal: () => null,
}));

jest.mock("./hard-delete-project-modal", () => ({
  HardDeleteProjectModal: () => null,
}));

jest.mock("./public-share-labels", () => ({
  publicShareCountFromProjectLabels: () => 0,
}));

jest.mock("./remove-myself", () => ({
  confirmRemoveMyselfFromProject: jest.fn(),
}));

jest.mock("./util", () => ({
  useFilesMenuItems: () => [],
  useRecentFiles: () => [],
  useServersMenuItems: () => [],
}));

describe("ProjectActionsMenu", () => {
  beforeEach(() => {
    moveProjectToHost.mockReset();
    refreshProjectRegion.mockClear();
    protectedActions.length = 0;
    runFreshAuthAction.mockReset();
    runFreshAuthAction.mockImplementation(async (action) => {
      protectedActions.push(action);
      return true;
    });
  });

  it("runs project moves through fresh authentication", async () => {
    render(
      <ProjectActionsMenu
        record={
          {
            project_id: "project-1",
            title: "Project One",
            labels: {},
            state: fromJS({ state: "running" }),
          } as any
        }
        onToggleDetails={jest.fn()}
      />,
    );

    fireEvent.click(screen.getByText("ellipsis"));
    fireEvent.click(screen.getByText("Move to host…"));
    await waitFor(() => expect(refreshProjectRegion).toHaveBeenCalledTimes(1));

    fireEvent.click(await screen.findByText("Select destination"));
    await waitFor(() => expect(runFreshAuthAction).toHaveBeenCalledTimes(1));

    expect(screen.getByTestId("fresh-auth-modal")).toBeTruthy();
    expect(moveProjectToHost).not.toHaveBeenCalled();
    expect(protectedActions).toHaveLength(1);

    await act(async () => await protectedActions[0]());
    expect(moveProjectToHost).toHaveBeenCalledWith("project-1", "host-2", {
      backup_region_cutover: true,
      dest_project_region: "weur",
    });
  });
});
