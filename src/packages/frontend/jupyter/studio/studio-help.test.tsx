/** @jest-environment jsdom */

/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { fireEvent, render, screen } from "@testing-library/react";

const openProjectDocs = jest.fn();
const openAppDocs = jest.fn();

jest.mock("@cocalc/frontend/components", () => ({
  Icon: () => null,
  Tooltip: ({ children }) => <>{children}</>,
}));

jest.mock("@cocalc/frontend/frame-editors/frame-tree/frame-context", () => ({
  useFrameContext: () => ({ project_id: "p1", id: "active", actions: {} }),
}));

jest.mock("react-intl", () => ({
  ...jest.requireActual("react-intl"),
  useIntl: () => ({ formatMessage: () => "Help" }),
}));

jest.mock("@cocalc/frontend/docs/navigation", () => ({
  normalizeDocsSlug: (slug: string) => slug,
  openAppDocs: (...args: any[]) => openAppDocs(...args),
  openProjectDocs: (...args: any[]) => openProjectDocs(...args),
}));

import StudioNotebookHelp, { STUDIO_DOCS_SLUG } from "./studio-help";

describe("Studio notebook help", () => {
  beforeEach(() => {
    openProjectDocs.mockClear();
    openAppDocs.mockClear();
  });

  it("is a link that opens the Studio docs entry in the project", () => {
    render(<StudioNotebookHelp />);

    const link = screen.getByRole("link", { name: "Help" });
    expect(link.getAttribute("href")).toContain(STUDIO_DOCS_SLUG);

    fireEvent.click(link, { button: 0 });
    expect(openProjectDocs).toHaveBeenCalledWith({
      projectId: "p1",
      slug: STUDIO_DOCS_SLUG,
    });
  });

  it("leaves modified clicks to the browser so the docs can open in a new tab", () => {
    render(<StudioNotebookHelp />);

    fireEvent.click(screen.getByRole("link", { name: "Help" }), {
      button: 0,
      ctrlKey: true,
    });
    expect(openProjectDocs).not.toHaveBeenCalled();
    expect(openAppDocs).not.toHaveBeenCalled();
  });
});
