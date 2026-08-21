/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  CHECK_BLIT_APPLICATION_COMMAND,
  INSTALL_BLIT_APPLICATION_COMMAND,
  LAUNCH_BLIT_APPLICATION_COMMAND,
} from "./blit-applications";
import { BlitLauncher } from "./blit-launcher";

const execMock = jest.fn();

jest.mock("@cocalc/frontend/frame-editors/generic/client", () => ({
  exec: (...args: unknown[]) => execMock(...args),
}));

const success = {
  exit_code: 0,
  stderr: "",
  stdout: "",
};

describe("Blit application launcher", () => {
  const originalGetComputedStyle = window.getComputedStyle;

  beforeAll(() => {
    jest
      .spyOn(window, "getComputedStyle")
      .mockImplementation((element) => originalGetComputedStyle(element));
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    execMock.mockReset();
  });

  it("launches another terminal without checking for an executable", async () => {
    execMock.mockResolvedValue(success);
    render(<BlitLauncher project_id="project-id" />);

    const terminal = screen.getByRole("button", { name: "Terminal" });
    terminal.focus();
    expect(terminal).toHaveFocus();
    fireEvent.click(terminal);

    await screen.findByRole("status");
    expect(screen.getByRole("status")).toHaveTextContent("Terminal launched.");
    expect(execMock).toHaveBeenCalledTimes(1);
    expect(execMock.mock.calls[0][0]).toMatchObject({
      args: [
        "-c",
        LAUNCH_BLIT_APPLICATION_COMMAND,
        "cocalc-blit-launch",
        "terminal",
      ],
      command: "bash",
      project_id: "project-id",
    });
  });

  it("checks and directly launches an installed application", async () => {
    execMock
      .mockResolvedValueOnce({
        ...success,
        stdout: "cocalc-blit-app:installed\n",
      })
      .mockResolvedValueOnce(success);
    render(<BlitLauncher project_id="project-id" />);

    fireEvent.click(screen.getByRole("button", { name: "GIMP" }));

    await waitFor(() => expect(execMock).toHaveBeenCalledTimes(2));
    expect(execMock.mock.calls[0][0]).toMatchObject({
      args: ["-c", CHECK_BLIT_APPLICATION_COMMAND, "cocalc-blit-check", "gimp"],
    });
    expect(execMock.mock.calls[1][0]).toMatchObject({
      args: [
        "-c",
        LAUNCH_BLIT_APPLICATION_COMMAND,
        "cocalc-blit-launch",
        "gimp",
        "gimp",
      ],
    });
    expect(screen.getByRole("status")).toHaveTextContent("GIMP launched.");
  });

  it("offers to install a missing application, then installs and launches it", async () => {
    execMock
      .mockResolvedValueOnce({
        ...success,
        stdout: "cocalc-blit-app:missing\n",
      })
      .mockResolvedValueOnce(success)
      .mockResolvedValueOnce(success);
    render(<BlitLauncher project_id="project-id" />);

    fireEvent.click(screen.getByRole("button", { name: "Inkscape" }));

    expect(
      await screen.findByRole("dialog", { name: "Install Inkscape?" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText("inkscape", { selector: "code" }),
    ).toBeInTheDocument();
    const install = screen.getByRole("button", { name: "Install Inkscape" });
    install.focus();
    expect(install).toHaveFocus();
    fireEvent.click(install);

    await waitFor(() => expect(execMock).toHaveBeenCalledTimes(3));
    expect(execMock.mock.calls[1][0]).toMatchObject({
      args: [
        "-c",
        INSTALL_BLIT_APPLICATION_COMMAND,
        "cocalc-blit-install",
        "inkscape",
      ],
    });
    expect(execMock.mock.calls[2][0]).toMatchObject({
      args: [
        "-c",
        LAUNCH_BLIT_APPLICATION_COMMAND,
        "cocalc-blit-launch",
        "inkscape",
        "inkscape",
      ],
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(screen.getByRole("status")).toHaveTextContent("Inkscape launched.");
  });

  it("keeps an installation failure visible in the confirmation dialog", async () => {
    execMock
      .mockResolvedValueOnce({
        ...success,
        stdout: "cocalc-blit-app:missing\n",
      })
      .mockRejectedValueOnce(new Error("apt failed"));
    render(<BlitLauncher project_id="project-id" />);

    fireEvent.click(screen.getByRole("button", { name: "Gnumeric" }));
    fireEvent.click(
      await screen.findByRole("button", { name: "Install Gnumeric" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("apt failed");
    expect(
      screen.getByRole("dialog", { name: "Install Gnumeric?" }),
    ).toBeVisible();
  });
});
