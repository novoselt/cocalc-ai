/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { resolveProjectHomeDirectory } from "@cocalc/frontend/project/home-directory";

import {
  isRetryableOnboardingArtifactError,
  onboardingArtifactCreation,
  onboardingArtifactCreationForProject,
  onboardingArtifactRouteTarget,
  waitForOnboardingArtifactAndRuntime,
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
      path: `/home/user/${path}`,
    });
  });

  it("opens starter artifacts using their rootfs-aware absolute route", () => {
    expect(onboardingArtifactRouteTarget("/home/user/Welcome.ipynb")).toBe(
      "files/home/user/Welcome.ipynb",
    );
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

  it("creates the artifact concurrently but waits for runtime readiness", async () => {
    let releaseRuntime!: () => void;
    const runtimeReady = new Promise<void>((resolve) => {
      releaseRuntime = resolve;
    });
    const createArtifact = jest.fn(async () => "Welcome.ipynb");
    const waitForRuntime = jest.fn(() => runtimeReady);
    let settled = false;

    const setup = waitForOnboardingArtifactAndRuntime({
      createArtifact,
      waitForRuntime,
    }).then((result) => {
      settled = true;
      return result;
    });
    await Promise.resolve();

    expect(createArtifact).toHaveBeenCalledTimes(1);
    expect(waitForRuntime).toHaveBeenCalledTimes(1);
    expect(settled).toBe(false);

    releaseRuntime();
    await expect(setup).resolves.toEqual({ artifact: "Welcome.ipynb" });
  });

  it("preserves a starter-file error after the runtime becomes ready", async () => {
    const error = new Error("starter failed");

    await expect(
      waitForOnboardingArtifactAndRuntime({
        createArtifact: async () => {
          throw error;
        },
        waitForRuntime: async () => undefined,
      }),
    ).resolves.toEqual({ error });
  });
});
