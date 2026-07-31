/** @jest-environment jsdom */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";

import { openAppDocs } from "@cocalc/frontend/docs/navigation";
import { assessExamHostCapacity, HostExamPanel } from "./host-exam-panel";

const mockGetHostExamState = jest.fn(async () => ({ eligible: true }));
const mockSetHostExamConfig = jest.fn();
const mockRunFreshAuthAction = jest.fn(
  async (action: () => Promise<unknown>) => {
    await action();
    return true;
  },
);

jest.mock("@cocalc/frontend/docs/navigation", () => ({
  openAppDocs: jest.fn(),
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    browser_id: "browser-1",
    conat_client: {
      hub: {
        hosts: {
          getHostExamState: (...args: any[]) => mockGetHostExamState(...args),
          setHostExamConfig: (...args: any[]) => mockSetHostExamConfig(...args),
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
  beforeEach(() => {
    mockGetHostExamState.mockClear();
    mockSetHostExamConfig.mockReset();
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

    fireEvent.click(screen.getByRole("button", { name: "Save configuration" }));

    await waitFor(() =>
      expect(mockRunFreshAuthAction).toHaveBeenCalledTimes(1),
    );
    expect(mockSetHostExamConfig).toHaveBeenCalledWith(
      expect.objectContaining({ browser_id: "browser-1" }),
    );
    expect(screen.queryByText(/fresh auth is required/)).toBeNull();
  });
});
