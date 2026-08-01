/** @jest-environment jsdom */

import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import { openAppDocs } from "@cocalc/frontend/docs/navigation";
import {
  assessExamHostCapacity,
  examRootfsCatalogEntries,
  HostExamPanel,
} from "./host-exam-panel";

const mockGetHostExamState = jest.fn(async () => ({ eligible: true }));
const mockSetHostExamConfig = jest.fn();
const mockCreateHostExamRun = jest.fn();
const mockRunFreshAuthAction = jest.fn(
  async (action: () => Promise<unknown>) => {
    await action();
    return true;
  },
);

jest.mock("@cocalc/frontend/docs/navigation", () => ({
  openAppDocs: jest.fn(),
}));

jest.mock("@cocalc/frontend/rootfs/manifest", () => ({
  managedRootfsCatalogUrl: () => "/rootfs/manifest.json",
  useRootfsImages: () => ({ images: [], loading: false }),
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    browser_id: "browser-1",
    conat_client: {
      hub: {
        hosts: {
          getHostExamState: (...args: any[]) => mockGetHostExamState(...args),
          setHostExamConfig: (...args: any[]) => mockSetHostExamConfig(...args),
          createHostExamRun: (...args: any[]) => mockCreateHostExamRun(...args),
        },
      },
    },
  },
}));

jest.mock("@cocalc/frontend/auth/fresh-auth", () => ({
  FreshAuthModal: () => null,
  useFreshAuthAction: () => ({
    freshAuthModalProps: {},
    runFreshAuthAction: (...args: any[]) => mockRunFreshAuthAction(...args),
  }),
}));

describe("HostExamPanel", () => {
  const savedConfig = {
    host_id: "host-1",
    enabled: true,
    title: "Exam Scratchpad",
    hostname: "exam-host-1.example.test",
    generation: 1,
    max_projects: 100,
    project_cpu: 1,
    project_memory_mb: 2_000,
    project_disk_mb: 5_000,
    project_ttl_minutes: 360,
    cleanup_grace_minutes: 10,
    terminal_enabled: false,
    network_mode: "disabled" as const,
    created_at: "2026-07-31T00:00:00.000Z",
    updated_at: "2026-07-31T00:00:00.000Z",
    created_by: "account-1",
    updated_by: "account-1",
  };

  beforeEach(() => {
    mockGetHostExamState.mockClear();
    mockSetHostExamConfig.mockReset();
    mockCreateHostExamRun.mockReset();
    mockRunFreshAuthAction.mockReset();
    mockRunFreshAuthAction.mockImplementation(
      async (action: () => Promise<unknown>) => {
        await action();
        return true;
      },
    );
  });

  it("translates maximum projects into conservative host guidance", () => {
    expect(
      assessExamHostCapacity({ maxProjects: 200, cpu: 8, ramGiB: 104 }),
    ).toEqual({
      level: "success",
      recommendedCpu: 8,
      recommendedRamGiB: 104,
    });
    expect(
      assessExamHostCapacity({ maxProjects: 200, cpu: 8, ramGiB: 50 }),
    ).toEqual({
      level: "close",
      recommendedCpu: 8,
      recommendedRamGiB: 104,
    });
    expect(
      assessExamHostCapacity({ maxProjects: 200, cpu: 2, ramGiB: 32 }),
    ).toEqual({
      level: "warning",
      recommendedCpu: 8,
      recommendedRamGiB: 104,
    });
  });

  it("does not claim that capacity is sufficient without host metrics", () => {
    expect(assessExamHostCapacity({ maxProjects: 20 })).toEqual({
      level: "unknown",
      recommendedCpu: 8,
      recommendedRamGiB: 14,
    });
  });

  it("enriches cached host images with project-creation catalog metadata", () => {
    expect(
      examRootfsCatalogEntries({
        cachedImages: [
          {
            image: "cocalc.local/rootfs/sage",
            digest: "sha256:cached",
          } as any,
        ],
        catalogImages: [
          {
            id: "sage",
            label: "SageMath",
            image: "cocalc.local/rootfs/sage",
            description: "Computational mathematics",
          },
        ],
      }),
    ).toEqual([
      expect.objectContaining({
        id: "sage",
        label: "SageMath",
        digest: "sha256:cached",
      }),
    ]);
  });

  it("opens the exam scratchpad documentation entry", () => {
    render(
      <HostExamPanel
        host={{ id: "host-1", status: "running" } as any}
        rootfsImages={[]}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /Read the setup, testing, and cleanup guide\./,
      }),
    );

    expect(openAppDocs).toHaveBeenCalledWith("hosts/exam-scratchpads");
  });

  it("shows a successful host capacity check", () => {
    render(
      <HostExamPanel
        host={
          {
            id: "host-1",
            status: "running",
            host_cpu_count: 16,
            host_ram_gb: 64,
          } as any
        }
        rootfsImages={[]}
      />,
    );

    expect(
      screen.getByText("Host capacity meets the exam guideline"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/For 100 simultaneous students.*54 GB RAM/),
    ).toBeInTheDocument();
  });

  it("only enables configuration saving after a field changes", async () => {
    mockGetHostExamState.mockResolvedValueOnce({
      eligible: true,
      config: savedConfig,
    });
    render(
      <HostExamPanel
        host={{ id: "host-1", status: "running" } as any}
        rootfsImages={[]}
      />,
    );

    const save = screen.getByRole("button", { name: "Save configuration" });
    await waitFor(() => expect(save).toBeDisabled());

    fireEvent.change(screen.getAllByRole("spinbutton")[0], {
      target: { value: "101" },
    });
    expect(save).toBeEnabled();
  });

  it("uses authoritative exam state to disable preparation when stopped", async () => {
    mockGetHostExamState.mockResolvedValueOnce({
      eligible: true,
      host_status: "off",
      config: savedConfig,
    });
    render(
      <HostExamPanel
        host={{ id: "host-1", status: "running" } as any}
        rootfsImages={[
          {
            image: "cocalc.local/rootfs/exam",
            digest: "sha256:abc",
          } as any,
        ]}
      />,
    );

    expect(
      await screen.findByText("Start the project host to prepare an exam"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Prepare and test run" }),
    ).toBeDisabled();
  });

  it("labels cleanup and defaults to shutting down the host", async () => {
    mockGetHostExamState.mockResolvedValueOnce({
      eligible: true,
      config: savedConfig,
    });
    mockCreateHostExamRun.mockResolvedValue({
      eligible: true,
      config: savedConfig,
    });
    render(
      <HostExamPanel
        host={{ id: "host-1", status: "running" } as any}
        rootfsImages={[
          {
            image: "cocalc.local/rootfs/exam",
            digest: "sha256:abc",
          } as any,
        ]}
      />,
    );

    expect(screen.getByText("Delete all exam projects at")).toBeInTheDocument();
    const shutdown = screen.getByRole("checkbox", {
      name: "Also shut down the project host to save resources",
    });
    expect(shutdown).toBeChecked();
    const prepare = screen.getByRole("button", {
      name: "Prepare and test run",
    });
    await waitFor(() => expect(prepare).toBeEnabled());
    fireEvent.click(shutdown);
    expect(shutdown).not.toBeChecked();
    fireEvent.click(prepare);
    await waitFor(() => expect(mockCreateHostExamRun).toHaveBeenCalled());
    expect(mockCreateHostExamRun).toHaveBeenCalledWith(
      expect.objectContaining({
        stop_host_at_deadline: false,
        timeout: 12 * 60_000,
      }),
    );
  });

  it("reuses one idempotency key when fresh auth retries preparation", async () => {
    mockGetHostExamState.mockResolvedValueOnce({
      eligible: true,
      config: savedConfig,
    });
    mockCreateHostExamRun.mockResolvedValue({
      eligible: true,
      config: savedConfig,
    });
    mockRunFreshAuthAction.mockImplementation(async (action) => {
      await action();
      await action();
      return true;
    });
    render(
      <HostExamPanel
        host={{ id: "host-1", status: "running" } as any}
        rootfsImages={[
          {
            image: "cocalc.local/rootfs/exam",
            digest: "sha256:abc",
          } as any,
        ]}
      />,
    );

    const prepare = screen.getByRole("button", {
      name: "Prepare and test run",
    });
    await waitFor(() => expect(prepare).toBeEnabled());
    fireEvent.click(prepare);
    await waitFor(() => expect(mockCreateHostExamRun).toHaveBeenCalledTimes(2));

    const firstKey = mockCreateHostExamRun.mock.calls[0][0].idempotency_key;
    const secondKey = mockCreateHostExamRun.mock.calls[1][0].idempotency_key;
    expect(firstKey).toMatch(/^create:/);
    expect(secondKey).toBe(firstKey);
  });

  it("explains the full rehearsal while preparation is running", async () => {
    mockGetHostExamState.mockResolvedValueOnce({
      eligible: true,
      config: savedConfig,
    });
    let finishPreparation!: (value: unknown) => void;
    mockCreateHostExamRun.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishPreparation = resolve;
        }),
    );
    render(
      <HostExamPanel
        host={{ id: "host-1", status: "running" } as any}
        rootfsImages={[
          {
            image: "cocalc.local/rootfs/exam",
            digest: "sha256:abc",
          } as any,
        ]}
      />,
    );

    expect(
      screen.getByText("Preparation runs a complete rehearsal"),
    ).toBeInTheDocument();
    const prepare = screen.getByRole("button", {
      name: "Prepare and test run",
    });
    await waitFor(() => expect(prepare).toBeEnabled());
    fireEvent.click(prepare);

    expect(
      await screen.findByText(/Creating a smoke-test project/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/This usually takes about one minute/),
    ).toBeInTheDocument();

    await act(async () => {
      finishPreparation({ eligible: true, config: savedConfig });
    });
    await waitFor(() =>
      expect(
        screen.queryByText(/Creating a smoke-test project/),
      ).not.toBeInTheDocument(),
    );
  });

  it("does not present a stopped historical run as the current run", async () => {
    mockGetHostExamState.mockResolvedValueOnce({
      eligible: true,
      config: savedConfig,
      run: {
        run_id: "stopped-run",
        status: "stopped",
        rootfs_image: "cocalc.local/rootfs/exam",
        scheduled_stop_at: "2026-07-30T00:00:00.000Z",
        stop_host_at_deadline: true,
      },
    });
    render(
      <HostExamPanel
        host={{ id: "host-1", status: "running" } as any}
        rootfsImages={[
          {
            image: "cocalc.local/rootfs/exam",
            digest: "sha256:abc",
          } as any,
        ]}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Prepare and test run" }),
      ).toBeEnabled(),
    );
    expect(screen.queryByText("Current run")).not.toBeInTheDocument();
    expect(screen.queryByText("stopped")).not.toBeInTheDocument();
  });

  it("shows the recoverable token after refreshing an active run", async () => {
    mockGetHostExamState.mockResolvedValueOnce({
      eligible: true,
      host_status: "running",
      config: savedConfig,
      token: "exam-token-visible-later",
      run: {
        run_id: "ready-run",
        status: "ready",
        rootfs_image: "cocalc.local/rootfs/exam",
        scheduled_stop_at: "2026-08-01T00:00:00.000Z",
        stop_host_at_deadline: true,
        max_projects: 100,
        terminal_enabled: false,
      },
      runtime: {
        admission_open: false,
        active_projects: 0,
      },
    });
    render(
      <HostExamPanel
        host={{ id: "host-1", status: "running" } as any}
        rootfsImages={[]}
      />,
    );

    expect(await screen.findByText("Student admission")).toBeInTheDocument();
    expect(
      screen.getByDisplayValue(
        "https://exam-host-1.example.test/#token=exam-token-visible-later",
      ),
    ).toBeVisible();
    expect(screen.getByDisplayValue("exam-token-visible-later")).toBeVisible();
    expect(
      screen.getByText(/without sending it to the server in the URL/),
    ).toBeInTheDocument();
  });

  it("leaves fresh-auth challenges for the fresh-auth flow", async () => {
    const freshAuthError = Object.assign(new Error("fresh auth is required"), {
      code: "fresh_auth_required",
    });
    mockSetHostExamConfig.mockRejectedValue(freshAuthError);
    mockRunFreshAuthAction.mockImplementation(async (action) => {
      try {
        await action();
      } catch (err) {
        expect(err).toBe(freshAuthError);
        return false;
      }
      throw new Error("expected the protected action to require fresh auth");
    });

    render(
      <HostExamPanel
        host={{ id: "host-1", status: "running" } as any}
        rootfsImages={[]}
      />,
    );

    const save = screen.getByRole("button", { name: "Save configuration" });
    await waitFor(() => expect(save).toBeEnabled());
    fireEvent.click(save);

    await waitFor(() =>
      expect(mockRunFreshAuthAction).toHaveBeenCalledTimes(1),
    );
    expect(mockSetHostExamConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        browser_id: "browser-1",
        timeout: 2 * 60_000,
      }),
    );
    expect(screen.queryByText(/fresh auth is required/)).toBeNull();
  });
});
