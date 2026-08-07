/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ResolvedPublicDirectoryShare } from "@cocalc/conat/hub/api/public-directory-shares";
import {
  normalizeShareDescriptionMarkdown,
  PublicDirectoryShareBanner,
} from "./public-directory-share-banner";

const copyToNewProject = jest.fn();
const copyToProject = jest.fn();
const getProjectRegion = jest.fn();
const getLro = jest.fn();
const openProject = jest.fn();

jest.mock("@cocalc/frontend/project/explorer/copy-ops", () => ({
  CopyOpRow: ({ op }: any) => (
    <div>
      Copy operation:{" "}
      {op.summary?.status ?? op.last_progress?.message ?? "queued"}
    </div>
  ),
}));

jest.mock("antd", () => {
  const Button = ({ children, disabled, loading, onClick, type }: any) => (
    <button
      data-type={type}
      disabled={disabled || loading}
      onClick={onClick}
      type="button"
    >
      {children}
    </button>
  );
  const Space = ({ children }: any) => <div>{children}</div>;
  return {
    Alert: ({ description, title }: any) => (
      <div>
        <div>{title}</div>
        <div>{description}</div>
      </div>
    ),
    Button,
    Input: ({ onChange, placeholder, value }: any) => (
      <input
        aria-label={placeholder}
        onChange={onChange}
        placeholder={placeholder}
        value={value}
      />
    ),
    Modal: ({ children, footer, open, title }: any) =>
      open ? (
        <div role="dialog">
          <div>{title}</div>
          {children}
          {footer}
        </div>
      ) : null,
    Space,
    Tag: ({ children }: any) => <span>{children}</span>,
    Typography: {
      Paragraph: ({ children }: any) => <p>{children}</p>,
      Text: ({ children }: any) => <span>{children}</span>,
    },
  };
});

jest.mock("@cocalc/frontend/app-framework", () => ({
  useActions: () => ({
    open_project: openProject,
  }),
}));

jest.mock("@cocalc/frontend/components", () => ({
  Icon: ({ name }: any) => <span data-testid={`icon-${name}`} />,
}));

jest.mock("@cocalc/frontend/project/home-directory", () => ({
  getProjectHomeDirectory: () => "/home/user",
}));

jest.mock("@cocalc/frontend/projects/select-project", () => ({
  SelectProject: ({ onChange }: any) => (
    <button onClick={() => onChange("existing-project")} type="button">
      SelectProject
    </button>
  ),
}));

jest.mock("@cocalc/frontend/components/theme-image-input", () => ({
  blobImageUrl: (blob: string, filename?: string) =>
    `/blobs/${filename ?? "theme-image.png"}?uuid=${blob}`,
}));

jest.mock("@cocalc/frontend/editors/slate/static-markdown-public", () => ({
  __esModule: true,
  default: ({ value }: { value: string }) => <div>{value}</div>,
}));

jest.mock("@cocalc/frontend/components/user-facing-error", () => ({
  normalizeUserFacingError: (err: unknown) => ({
    message: (err as any)?.message ?? `${err}`,
  }),
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    conat_client: {
      hub: {
        lro: {
          get: (...args: any[]) => getLro(...args),
        },
        projects: {
          getProjectRegion: (...args: any[]) => getProjectRegion(...args),
        },
        publicDirectoryShares: {
          copyToNewProject: (...args: any[]) => copyToNewProject(...args),
          copyToProject: (...args: any[]) => copyToProject(...args),
        },
      },
    },
  },
}));

function share(): ResolvedPublicDirectoryShare {
  return {
    id: "share-id",
    project_id: "source-project",
    path: "share",
    slug: "test2",
    visibility: "unlisted",
    requires_auth: true,
    availability_status: "available",
    title: "Test Share",
    description: null,
    license: null,
    image: null,
    theme: null,
    redirect: null,
    legacy_public_path_id: null,
    legacy_url: null,
    site_license_id: null,
    site_license_pool_id: null,
    site_license_membership_tier_id: null,
    site_license_duration_days: null,
    site_license_grant_on_copy: false,
    site_license_copy_requires_grant: false,
    disabled: false,
    read_policy: { rules: [{ action: "include", path: "share/**" }] },
    available: true,
    created_by: null,
    updated_by: null,
    project_title: "Source Project",
    host_id: null,
    host_connection: null,
    owning_bay_id: "bay-0",
  } as ResolvedPublicDirectoryShare;
}

describe("PublicDirectoryShareBanner", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    window.localStorage.clear();
    copyToNewProject.mockResolvedValue({
      destination_project_id: "new-project",
      destination_path: "test2",
      op_id: "op-1",
      scope_id: "new-project",
      scope_type: "project",
      site_license_grant: null,
      created_project: true,
      reused_project: false,
      placed_on_requested_host: true,
      requested_host_id: "source-host",
    });
    getLro.mockResolvedValue({ status: "succeeded" });
    getProjectRegion.mockResolvedValue("wnam");
  });

  it("normalizes doubled legacy LaTeX escapes in share descriptions", () => {
    expect(
      normalizeShareDescriptionMarkdown(
        "Equation: \\\\(x^2\\\\) and \\\\[y = \\\\alpha\\\\]",
      ),
    ).toBe("Equation: \\(x^2\\) and \\[y = \\alpha\\]");
  });

  it("normalizes escaped legacy newlines in share descriptions", () => {
    expect(
      normalizeShareDescriptionMarkdown(
        "First paragraph.\\n\\nSecond paragraph.\\n- item",
      ),
    ).toBe("First paragraph.\n\nSecond paragraph.\n- item");
  });

  it("shows public share branding metadata in the banner", () => {
    const publicShare = {
      ...share(),
      created_by: "publisher-account-id",
      description: "Course materials for the Cambridge workshop.",
      image: "https://example.com/banner.png",
      license: "CC-BY 4.0",
    } as ResolvedPublicDirectoryShare;
    const { container } = render(
      <PublicDirectoryShareBanner share={publicShare} />,
    );

    expect(screen.getByText("Test Share")).toBeTruthy();
    expect(
      screen.getByText("Course materials for the Cambridge workshop."),
    ).toBeTruthy();
    expect(screen.getByText("License: CC-BY 4.0")).toBeTruthy();
    expect(
      screen.getByText(
        "Published from Source Project · Publisher publisher-account-id",
      ),
    ).toBeTruthy();
    expect(
      container.querySelector('img[alt="Test Share"]')?.getAttribute("src"),
    ).toBe("https://example.com/banner.png");
  });

  it("renders uploaded theme image blobs and rejects unsafe image schemes", () => {
    const blobShare = {
      ...share(),
      image: "8ac75262-dcd0-4a0a-883c-bce078e30c17",
    } as ResolvedPublicDirectoryShare;
    const blobView = render(<PublicDirectoryShareBanner share={blobShare} />);
    expect(
      blobView.container
        .querySelector('img[alt="Test Share"]')
        ?.getAttribute("src"),
    ).toBe(
      "/blobs/public-share-theme.png?uuid=8ac75262-dcd0-4a0a-883c-bce078e30c17",
    );
    blobView.unmount();

    const unsafeShare = {
      ...share(),
      image: "javascript:alert(1)",
    } as ResolvedPublicDirectoryShare;
    const unsafeView = render(
      <PublicDirectoryShareBanner share={unsafeShare} />,
    );
    expect(unsafeView.container.querySelector("img")).toBeNull();
  });

  it("collapses and expands the share banner", () => {
    render(<PublicDirectoryShareBanner share={share()} />);

    fireEvent.click(screen.getByText("Collapse"));
    expect(screen.getByText("Expand")).toBeTruthy();
    expect(screen.getByText("Test Share")).toBeTruthy();

    fireEvent.click(screen.getByText("Expand"));
    expect(screen.getByText("Collapse")).toBeTruthy();
  });

  function clickModalCopyButton() {
    const buttons = screen.getAllByText("Copy");
    fireEvent.click(buttons[buttons.length - 1]);
  }

  it("waits for default copy success before opening the target project", async () => {
    render(<PublicDirectoryShareBanner share={share()} />);

    fireEvent.click(screen.getByText("Copy"));
    clickModalCopyButton();

    await waitFor(() => {
      expect(openProject).toHaveBeenCalledWith({
        project_id: "new-project",
        switch_to: true,
        target: "files/home/user/test2/",
      });
    });
    expect(copyToNewProject).toHaveBeenCalledWith({
      slug: "test2",
      reuse_existing: true,
      overwrite_existing: false,
      options: { recursive: true },
    });
    expect(getLro).toHaveBeenCalledWith({ op_id: "op-1" });
    expect(getProjectRegion).toHaveBeenCalledWith({
      project_id: "new-project",
    });
    expect(getLro.mock.invocationCallOrder[0]).toBeLessThan(
      openProject.mock.invocationCallOrder[0],
    );
  });

  it("copies a folder into its slug when selecting an existing project", async () => {
    copyToProject.mockResolvedValueOnce({
      destination_project_id: "existing-project",
      destination_path: "test2",
      op_id: "op-existing",
      scope_id: "existing-project",
      scope_type: "project",
      site_license_grant: null,
    });
    render(<PublicDirectoryShareBanner share={share()} />);

    fireEvent.click(screen.getByText("Copy"));
    fireEvent.click(screen.getByText("Copy to existing project"));
    expect(screen.getByLabelText("Destination path")).toHaveValue("test2");
    fireEvent.click(screen.getByText("SelectProject"));
    fireEvent.click(screen.getByText("Copy to project"));

    await waitFor(() => {
      expect(copyToProject).toHaveBeenCalledWith({
        slug: "test2",
        destination_project_id: "existing-project",
        destination_path: "test2",
        options: { recursive: true },
      });
    });
    expect(openProject).toHaveBeenCalledWith({
      project_id: "existing-project",
      switch_to: true,
      target: "files/home/user/test2/",
    });
  });

  it("does not open the new project before it is readable", async () => {
    jest.useFakeTimers();
    getProjectRegion.mockRejectedValue(new Error("not ready"));
    render(<PublicDirectoryShareBanner share={share()} />);

    fireEvent.click(screen.getByText("Copy"));
    clickModalCopyButton();

    await waitFor(() => {
      expect(getLro).toHaveBeenCalled();
    });
    await act(async () => {
      await jest.runAllTimersAsync();
    });

    await waitFor(() => {
      expect(
        screen.getByText(/not yet available in your project list/),
      ).toBeTruthy();
    });
    expect(openProject).not.toHaveBeenCalled();
    jest.useRealTimers();
  });

  it("does not open the new project when the queued copy fails", async () => {
    getLro.mockResolvedValueOnce({
      status: "failed",
      error: "copy failed",
    });
    render(<PublicDirectoryShareBanner share={share()} />);

    fireEvent.click(screen.getByText("Copy"));
    clickModalCopyButton();

    await waitFor(() => {
      expect(screen.getByText("copy failed")).toBeTruthy();
    });
    expect(openProject).not.toHaveBeenCalled();
  });

  it("surfaces a transient LRO refresh failure while retrying", async () => {
    getLro.mockRejectedValue(
      new Error("unable to track durable copy operation"),
    );
    render(<PublicDirectoryShareBanner share={share()} />);

    fireEvent.click(screen.getByText("Copy"));
    clickModalCopyButton();

    await waitFor(() => {
      expect(
        screen.getByText(
          "Unable to refresh copy status; retrying. unable to track durable copy operation",
        ),
      ).toBeTruthy();
    });
    expect(openProject).not.toHaveBeenCalled();
  });

  it("shows the destination and operation while a default copy is running", async () => {
    getLro.mockResolvedValue({ status: "queued" });
    render(<PublicDirectoryShareBanner share={share()} />);

    fireEvent.click(screen.getByText("Copy"));
    clickModalCopyButton();

    await waitFor(() => {
      expect(screen.getByText("Destination: new project")).toBeTruthy();
    });
    expect(screen.getByText("Copy operation: queued")).toBeTruthy();
    expect(screen.getByText("new-project")).toBeTruthy();
    expect(within(screen.getByRole("dialog")).getByText("test2")).toBeTruthy();
    expect(screen.getByText("op-1")).toBeTruthy();
    expect(
      screen.getByText("Placed on the source host for a same-host copy."),
    ).toBeTruthy();

    fireEvent.click(screen.getByText("Open destination project"));
    expect(openProject).toHaveBeenCalledWith({
      project_id: "new-project",
      switch_to: true,
      target: "files",
    });
  });

  it("shows progress and explains when same-host placement falls back", async () => {
    copyToNewProject.mockResolvedValueOnce({
      destination_project_id: "new-project",
      destination_path: "test2",
      op_id: "op-1",
      scope_id: "new-project",
      scope_type: "project",
      site_license_grant: null,
      created_project: true,
      reused_project: false,
      placed_on_requested_host: false,
      requested_host_id: "source-host",
      host_placement_message: "host source-host is unavailable",
    });
    getLro.mockResolvedValue({ status: "succeeded" });
    render(<PublicDirectoryShareBanner share={share()} />);

    fireEvent.click(screen.getByText("Copy"));
    clickModalCopyButton();

    await waitFor(() => {
      expect(screen.getByText(/source host was not available/)).toBeTruthy();
    });
    expect(screen.getByText(/host source-host is unavailable/)).toBeTruthy();
    await waitFor(() => {
      expect(openProject).toHaveBeenCalled();
    });
  });

  it("offers to open or overwrite a reused project conflict", async () => {
    copyToNewProject.mockResolvedValueOnce({
      destination_project_id: "existing-project",
      created_project: false,
      reused_project: true,
      placed_on_requested_host: true,
      conflict: {
        reason: "path_exists",
        message:
          "This published folder was already copied to the compatible project.",
        destination_path: "test2",
        can_overwrite: true,
      },
    });
    copyToNewProject.mockResolvedValueOnce({
      destination_project_id: "existing-project",
      destination_path: "test2",
      op_id: "op-2",
      scope_id: "existing-project",
      scope_type: "project",
      site_license_grant: null,
      created_project: false,
      reused_project: true,
      placed_on_requested_host: true,
    });
    render(<PublicDirectoryShareBanner share={share()} />);

    fireEvent.click(screen.getByText("Copy"));
    clickModalCopyButton();

    await waitFor(() => {
      expect(
        screen.getByText(
          "This published folder was already copied to the compatible project.",
        ),
      ).toBeTruthy();
    });
    fireEvent.click(screen.getByText("Open existing copy"));
    expect(openProject).toHaveBeenCalledWith({
      project_id: "existing-project",
      switch_to: true,
      target: "files/home/user/test2/",
    });

    fireEvent.click(screen.getByText("Overwrite"));
    await waitFor(() => {
      expect(copyToNewProject).toHaveBeenLastCalledWith({
        slug: "test2",
        reuse_existing: true,
        overwrite_existing: true,
        options: { recursive: true },
      });
    });
  });

  it("opens an exact-file copy directly", async () => {
    copyToNewProject.mockResolvedValueOnce({
      destination_project_id: "new-project",
      destination_path: "tutorial.ipynb",
      op_id: "op-file",
      scope_id: "new-project",
      scope_type: "project",
      site_license_grant: null,
      created_project: true,
      reused_project: false,
      placed_on_requested_host: true,
    });
    const fileShare = {
      ...share(),
      path: "notebooks/tutorial.ipynb",
      path_type: "file",
    } as ResolvedPublicDirectoryShare;
    render(<PublicDirectoryShareBanner share={fileShare} />);

    fireEvent.click(screen.getByText("Copy"));
    clickModalCopyButton();

    await waitFor(() => {
      expect(openProject).toHaveBeenCalledWith({
        project_id: "new-project",
        switch_to: true,
        target: "files/home/user/tutorial.ipynb",
      });
    });
  });
});
