/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { openAccountSettings } from "@cocalc/frontend/account/settings-routing";
import openSupportTab from "@cocalc/frontend/support/open";
import { SNAPSHOTS } from "@cocalc/util/consts/snapshots";
import { DEFAULT_PROJECT_RUNTIME_HOME } from "@cocalc/util/project-runtime";
import { ProjectDiskQuotaRemediation } from "./quota-remediation";

const setCurrentPath = jest.fn();
const setActiveTab = jest.fn();
const openDirectory = jest.fn(async () => undefined);

jest.mock("@cocalc/frontend/app-framework", () => ({
  redux: {
    getProjectActions: () => ({
      set_current_path: setCurrentPath,
      set_active_tab: setActiveTab,
      open_directory: openDirectory,
    }),
  },
}));

jest.mock("@cocalc/frontend/account/settings-routing", () => ({
  openAccountSettings: jest.fn(),
}));

jest.mock("@cocalc/frontend/support/open", () => ({
  __esModule: true,
  default: jest.fn(),
}));

describe("ProjectDiskQuotaRemediation", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it("offers recovery actions that do not require starting the project", async () => {
    const onNavigate = jest.fn();
    render(
      <ProjectDiskQuotaRemediation
        project_id="project-1"
        onNavigate={onNavigate}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Manage files" }));
    expect(setCurrentPath).toHaveBeenCalledWith(DEFAULT_PROJECT_RUNTIME_HOME);
    expect(setActiveTab).toHaveBeenCalledWith("files");

    fireEvent.click(screen.getByRole("button", { name: "Manage snapshots" }));
    await waitFor(() => expect(openDirectory).toHaveBeenCalledWith(SNAPSHOTS));

    fireEvent.click(screen.getByRole("button", { name: "Upgrade membership" }));
    expect(openAccountSettings).toHaveBeenCalledWith({ page: "membership" });

    fireEvent.click(screen.getByRole("button", { name: "Contact support" }));
    expect(openSupportTab).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Request more project storage",
        body: expect.stringContaining("project-1"),
      }),
    );
    expect(onNavigate).toHaveBeenCalledTimes(4);
  });
});
