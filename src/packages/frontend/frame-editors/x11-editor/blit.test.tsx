/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Blit } from "./blit";
import { INSTALL_GRAPHICAL_APPS_COMMAND } from "./blit-app";

const execMock = jest.fn();

jest.mock("@cocalc/frontend/frame-editors/generic/client", () => ({
  exec: (...args: unknown[]) => execMock(...args),
}));

jest.mock("@cocalc/frontend/project/app-server-open", () => ({
  getProjectAppOpenUrl: jest.fn(),
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {},
}));

describe("Blit graphical application setup", () => {
  beforeEach(() => {
    execMock.mockReset();
  });

  it("offers a keyboard-focusable package install when dependencies are missing", async () => {
    execMock
      .mockResolvedValueOnce({
        exit_code: 21,
        stderr: "",
        stdout: "missing-package:xwayland\n",
      })
      .mockImplementationOnce(() => new Promise(() => {}));

    render(<Blit is_current project_id="project-id" />);

    const install = await screen.findByRole("button", {
      name: "Install graphical application support",
    });
    install.focus();
    expect(install).toHaveFocus();
    fireEvent.click(install);

    await waitFor(() => expect(execMock).toHaveBeenCalledTimes(2));
    expect(execMock.mock.calls[1][0]).toMatchObject({
      args: ["-lc", INSTALL_GRAPHICAL_APPS_COMMAND],
      command: "bash",
      project_id: "project-id",
    });
  });
});
