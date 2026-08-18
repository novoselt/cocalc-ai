/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { ChunkErrorBoundary, EssentialLink, OverflowMenu } from "./ui";

function BrokenChunk(): never {
  throw new Error("Loading chunk failed");
}

test("contains an optional chunk failure and exposes local recovery", () => {
  const consoleError = jest.spyOn(console, "error").mockImplementation();
  render(
    <ChunkErrorBoundary label="Files">
      <BrokenChunk />
    </ChunkErrorBoundary>,
  );

  expect(
    screen.getByRole("heading", { name: "Files could not be displayed" }),
  ).toBeVisible();
  expect(screen.getByRole("button", { name: "Reload CoCalc" })).toBeVisible();
  consoleError.mockRestore();
});

test("essential navigation uses a real link and preserves modified clicks", () => {
  window.history.replaceState({}, "", "/essential/projects");
  render(
    <EssentialLink
      route={{
        kind: "files",
        path: "/home/user",
        projectId: "11111111-1111-4111-8111-111111111111",
      }}
    >
      Open files
    </EssentialLink>,
  );

  const link = screen.getByRole("link", { name: "Open files" });
  expect(link).toHaveAttribute(
    "href",
    "/essential/projects/11111111-1111-4111-8111-111111111111/files/home/user/",
  );
  const modified = new MouseEvent("click", {
    bubbles: true,
    ctrlKey: true,
  });
  link.dispatchEvent(modified);
  expect(modified.defaultPrevented).toBe(false);
  expect(window.location.pathname).toBe("/essential/projects");

  fireEvent.click(link);
  expect(window.location.pathname).toContain(
    "/essential/projects/11111111-1111-4111-8111-111111111111/files/home/user",
  );
});

test("overflow menu closes on Escape and restores focus", () => {
  render(
    <OverflowMenu label="More tools">
      <button className="ul-menu-item" type="button">
        Settings
      </button>
    </OverflowMenu>,
  );
  const summary = screen.getByTitle("More tools");
  fireEvent.click(summary);
  expect(summary.closest("details")).toHaveAttribute("open");
  fireEvent.keyDown(summary.closest("details")!, { key: "Escape" });
  expect(summary.closest("details")).not.toHaveAttribute("open");
  expect(summary).toHaveFocus();
});
