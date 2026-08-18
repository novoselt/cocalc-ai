/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AccountProjectListWindowRow } from "@cocalc/conat/hub/api/projects";
import ProjectsWorkspace from "./projects-workspace";
import { getAccountProjectWindow } from "./api";
import { loadUltraliteSession } from "./session-loader";

jest.mock("./api", () => ({
  getAccountProjectWindow: jest.fn(),
}));
jest.mock("./session-loader", () => ({
  loadUltraliteSession: jest.fn(),
}));

const project = {
  project_id: "11111111-1111-4111-8111-111111111111",
  title: "First project",
} as AccountProjectListWindowRow;

beforeEach(() => {
  window.history.replaceState({}, "", "/essential/projects");
  jest.clearAllMocks();
});

test("first-run onboarding creates and opens a project on the home bay", async () => {
  const createProject = jest.fn(async () => project.project_id);
  const close = jest.fn();
  jest.mocked(loadUltraliteSession).mockResolvedValue({
    UltraliteSession: {
      open: jest.fn(async () => ({
        close,
        hubApi: { projects: { createProject } },
      })),
    },
  } as never);
  jest.mocked(getAccountProjectWindow).mockResolvedValue({
    hasMore: false,
    projects: [project],
  });

  render(
    <ProjectsWorkspace
      bootstrap={{
        account_id: "22222222-2222-4222-8222-222222222222",
        email_address_verified: true,
        home_bay_url: "https://home.example.test",
        project_window: [],
        signed_in: true,
      }}
    />,
  );

  expect(
    screen.getByRole("heading", { name: "Start your first project" }),
  ).toBeVisible();
  fireEvent.change(screen.getByLabelText("Project name"), {
    target: { value: "First project" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create project" }));

  await waitFor(() => expect(createProject).toHaveBeenCalled());
  expect(createProject).toHaveBeenCalledWith({
    description: "",
    start: false,
    title: "First project",
  });
  await waitFor(() =>
    expect(window.location.pathname).toContain(
      `/essential/projects/${project.project_id}/files/home/user`,
    ),
  );
  expect(getAccountProjectWindow).toHaveBeenCalledWith({
    bootstrap: expect.objectContaining({
      home_bay_url: "https://home.example.test",
    }),
    request: { limit: 1, project_id: project.project_id },
  });
  expect(close).toHaveBeenCalled();
});

test("unverified accounts cannot create a project", () => {
  render(
    <ProjectsWorkspace
      bootstrap={{
        email_address_verified: false,
        project_window: [],
        signed_in: true,
      }}
    />,
  );

  expect(screen.getByText(/Verify your email address/)).toBeVisible();
  expect(screen.getByRole("button", { name: "Create project" })).toBeDisabled();
  expect(loadUltraliteSession).not.toHaveBeenCalled();
});
