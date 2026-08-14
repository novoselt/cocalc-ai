import React from "react";
import { render, screen, waitFor } from "@testing-library/react";

const listAgentGrants = jest.fn();

jest.mock("@cocalc/frontend/customize/app-base-path", () => ({
  appBasePath: "/projects",
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    conat_client: {
      hub: {
        compute: {
          listAgentGrants: (...args: any[]) => listAgentGrants(...args),
        },
      },
    },
  },
}));

import { CodexVmApprovalPrompt } from "../codex-vm-approval";

describe("CodexVmApprovalPrompt", () => {
  beforeEach(() => listAgentGrants.mockReset());

  it("shows a direct approval link for a pending request", async () => {
    listAgentGrants.mockResolvedValue([
      {
        grant_id: "f2e52b2e-8839-4158-a1cd-bbc0088b4087",
        metadata: { pending_request: { operation: "stop-vm" } },
      },
    ]);

    const { unmount } = render(
      <CodexVmApprovalPrompt projectId="project-1" active />,
    );
    const link = await screen.findByRole("link", {
      name: "Review and approve VM access",
    });
    expect(link.getAttribute("href")).toBe(
      "/projects/project-1/vms?agent_grant=f2e52b2e-8839-4158-a1cd-bbc0088b4087",
    );
    expect(screen.getByText(/stop-vm request/)).not.toBeNull();
    expect(listAgentGrants).toHaveBeenCalledWith({ project_id: "project-1" });
    unmount();
  });

  it("does not query while no mutating VM command is active", async () => {
    render(<CodexVmApprovalPrompt projectId="project-1" active={false} />);
    await waitFor(() => expect(listAgentGrants).not.toHaveBeenCalled());
    expect(
      screen.queryByRole("link", { name: "Review and approve VM access" }),
    ).toBeNull();
  });
});
