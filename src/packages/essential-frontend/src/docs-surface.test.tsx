/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import DocsSurface, { essentialDocsHref } from "./docs-surface";

test("lists and searches the lightweight documentation", async () => {
  render(<DocsSurface route={{ kind: "docs" }} />);

  expect(screen.getByRole("heading", { name: "Essential Docs" })).toBeVisible();
  expect(screen.getAllByRole("link").length).toBeGreaterThan(10);

  fireEvent.change(screen.getByRole("searchbox"), {
    target: { value: "custom jupyter kernels" },
  });
  expect(
    await screen.findByRole("link", { name: /Custom Jupyter kernels/ }),
  ).toHaveAttribute("href", "/essential/docs/jupyter/custom-kernels");
});

test("renders a documentation body without actions or images", () => {
  render(<DocsSurface route={{ kind: "docs", slug: "files/project-files" }} />);

  expect(
    screen.getByRole("heading", { name: "Work with project files" }),
  ).toBeVisible();
  expect(screen.queryByRole("img")).not.toBeInTheDocument();
  expect(screen.queryByText("Open project files")).not.toBeInTheDocument();
});

test("rewrites full documentation links to Essential routes", () => {
  expect(essentialDocsHref("/docs/jupyter/create-notebook")).toBe(
    "/essential/docs/jupyter/create-notebook",
  );
  expect(essentialDocsHref("https://example.com/docs")).toBe(
    "https://example.com/docs",
  );
});
