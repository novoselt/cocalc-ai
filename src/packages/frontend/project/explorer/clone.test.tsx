/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { IntlProvider } from "react-intl";

import CloneProject from "./clone";

const cloneProject = jest.fn(async () => undefined);

jest.mock("@cocalc/frontend/app-framework", () => ({
  redux: {
    getActions: () => ({ cloneProject }),
    getStore: () => ({ getIn: () => "Source project" }),
  },
}));

jest.mock("@cocalc/frontend/components", () => ({
  Tooltip: ({ children }: { children: ReactNode }) => children,
}));
jest.mock("@cocalc/frontend/components/error", () => () => null);
jest.mock("@cocalc/frontend/components/icon", () => ({
  Icon: () => null,
}));
jest.mock("@cocalc/frontend/projects/project-title", () => ({
  ProjectTitle: () => <>Source project</>,
}));

test("opens and confirms cloning when tooltips are hidden", async () => {
  render(
    <IntlProvider locale="en">
      <CloneProject project_id="project-id" />
    </IntlProvider>,
  );

  const clone = screen.getByRole("button", { name: "Clone" });
  fireEvent.click(clone);
  expect(await screen.findByText(/Create a clone of/)).toBeInTheDocument();
  expect(clone.parentElement).toHaveClass("ant-popover-open");
  expect(clone.parentElement).toHaveAttribute("aria-describedby");

  fireEvent.click(screen.getByRole("button", { name: "Create Clone" }));
  expect(cloneProject).toHaveBeenCalledWith({
    project_id: "project-id",
    title: "Clone of Source project",
  });
});
