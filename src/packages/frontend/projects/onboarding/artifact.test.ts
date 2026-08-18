/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { resolveProjectHomeDirectory } from "@cocalc/frontend/project/home-directory";

import {
  isRetryableOnboardingArtifactError,
  onboardingArtifactCreation,
  onboardingArtifactCreationForProject,
} from "./artifact";

jest.mock("@cocalc/frontend/project/home-directory", () => ({
  resolveProjectHomeDirectory: jest.fn(),
}));

const mockResolveProjectHomeDirectory = jest.mocked(
  resolveProjectHomeDirectory,
);

describe("first-run onboarding artifact creation", () => {
  it.each([
    ["jupyter-python", "Welcome.ipynb"],
    ["jupyter-r", "Welcome.ipynb"],
    ["jupyter-julia", "Welcome.ipynb"],
    ["sage", "Welcome.ipynb"],
    ["code", "Terminal.term"],
    ["latex", "document.tex"],
    ["teaching", "Course.course"],
  ] as const)("creates %s artifacts in the project home", (kind, path) => {
    expect(onboardingArtifactCreation(kind, "/home/user")).toEqual({
      name: path.slice(0, path.lastIndexOf(".")),
      ext: path.slice(path.lastIndexOf(".") + 1),
      current_path: "/home/user",
      switch_over: false,
      relative_path: path,
    });
  });

  it("uses the runtime-provided home instead of assuming /home/user", () => {
    expect(
      onboardingArtifactCreation("latex", "/home/custom")?.current_path,
    ).toBe("/home/custom");
  });

  it("resolves the canonical home for the newly created project", async () => {
    mockResolveProjectHomeDirectory.mockResolvedValueOnce("/home/user");

    await expect(
      onboardingArtifactCreationForProject({
        kind: "latex",
        project_id: "project-1",
      }),
    ).resolves.toMatchObject({ current_path: "/home/user" });
    expect(mockResolveProjectHomeDirectory).toHaveBeenCalledWith("project-1");
  });

  it("does not create a starter artifact for Codex projects", () => {
    expect(onboardingArtifactCreation("codex", "/home/user")).toBeUndefined();
  });

  it("retries starter creation while the RootFS is still mounting", () => {
    expect(
      isRetryableOnboardingArtifactError(
        new Error(
          "rootfs is not mounted; cannot access absolute path '/home'. Start the project and try again.",
        ),
      ),
    ).toBe(true);
    expect(
      isRetryableOnboardingArtifactError(new Error("permission denied")),
    ).toBe(false);
  });
});
