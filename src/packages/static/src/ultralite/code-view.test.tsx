/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import CodeView from "./code-view";
import { navigate } from "./routes";

function props(writeFileIfUnchanged = jest.fn(async () => undefined)) {
  return {
    contents: "old\n",
    filesystem: { writeFileIfUnchanged } as any,
    onDirtyChange: jest.fn(),
    onSaved: jest.fn(),
    path: "/home/user/notes.txt",
    readOnly: false,
  };
}

afterEach(() => jest.restoreAllMocks());

test("saves exactly against the version that was opened", async () => {
  const value = props();
  render(<CodeView {...value} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Edit notes.txt" }), {
    target: { value: "new\n" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  await waitFor(() =>
    expect(value.filesystem.writeFileIfUnchanged).toHaveBeenCalledWith(
      "/home/user/notes.txt",
      "new\n",
      "old\n",
      true,
    ),
  );
  expect(value.onSaved).toHaveBeenCalledWith("new\n");
  expect(await screen.findByText("Saved.")).toBeVisible();
});

test("keeps the draft and blocks overwrite after an etag conflict", async () => {
  const conflict = Object.assign(new Error("changed"), {
    code: "ETAG_MISMATCH",
  });
  const value = props(jest.fn(async () => Promise.reject(conflict)));
  render(<CodeView {...value} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Edit notes.txt" }), {
    target: { value: "my draft\n" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));

  expect(
    await screen.findByText(/changed on the server after you opened it/),
  ).toBeVisible();
  expect(screen.getByRole("textbox", { name: "Edit notes.txt" })).toHaveValue(
    "my draft\n",
  );
  expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  expect(value.filesystem.writeFileIfUnchanged).toHaveBeenCalledTimes(1);
});

test("can cancel constrained-client navigation while dirty", () => {
  const value = props();
  jest.spyOn(window, "confirm").mockReturnValue(false);
  window.location.hash = "#/projects";
  render(<CodeView {...value} />);
  fireEvent.click(screen.getByRole("button", { name: "Edit" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Edit notes.txt" }), {
    target: { value: "dirty" },
  });

  navigate({
    kind: "files",
    projectId: "11111111-1111-4111-8111-111111111111",
    path: "/home/user",
  });

  expect(window.location.hash).toBe("#/projects");
});
