/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import "@testing-library/jest-dom";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import NotebookEditor, { notebookOutputFromMessage } from "./notebook-editor";

const baseContents = JSON.stringify({
  cells: [
    {
      cell_type: "code",
      execution_count: null,
      id: "cell-1",
      metadata: {},
      outputs: [],
      source: "print('hello')",
    },
  ],
  metadata: {},
  nbformat: 4,
  nbformat_minor: 5,
});

function setup({ latest = baseContents } = {}) {
  const filesystem = {
    readFile: jest.fn(async () => latest),
    writeFileIfUnchanged: jest.fn(async () => undefined),
  };
  const session = {
    ensureProjectRunning: jest.fn(async () => undefined),
    openProjectApi: jest.fn(),
  };
  render(
    <NotebookEditor
      baseContents={baseContents}
      filesystem={filesystem as any}
      notebook={JSON.parse(baseContents)}
      path="/home/user/test.ipynb"
      project={
        {
          host_id: "host-1",
          project_id: "11111111-1111-4111-8111-111111111111",
          title: "Test",
        } as any
      }
      readOnly={false}
      session={session as any}
    />,
  );
  return { filesystem, session };
}

test("opening executable notebook controls does not start project compute", () => {
  const { filesystem, session } = setup();

  expect(screen.getByText("Kernel: not started")).toBeVisible();
  expect(filesystem.readFile).not.toHaveBeenCalled();
  expect(session.ensureProjectRunning).not.toHaveBeenCalled();
  expect(session.openProjectApi).not.toHaveBeenCalled();
});

test("saving uses a conflict-safe write without starting compute", async () => {
  const { filesystem, session } = setup();
  fireEvent.change(screen.getByRole("textbox", { name: "Source for cell 1" }), {
    target: { value: "print('changed')" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Save notebook" }));

  await waitFor(() =>
    expect(filesystem.writeFileIfUnchanged).toHaveBeenCalledWith(
      "/home/user/test.ipynb",
      expect.stringContaining("print('changed')"),
      baseContents,
      true,
    ),
  );
  expect(session.ensureProjectRunning).not.toHaveBeenCalled();
});

test("a changed canonical notebook blocks execution before compute starts", async () => {
  const { filesystem, session } = setup({ latest: `${baseContents}\n` });
  fireEvent.click(screen.getByRole("button", { name: "Run all" }));

  expect(
    await screen.findByText(/changed on the server.*Nothing was executed/i),
  ).toBeVisible();
  expect(filesystem.writeFileIfUnchanged).not.toHaveBeenCalled();
  expect(session.ensureProjectRunning).not.toHaveBeenCalled();
  expect(session.openProjectApi).not.toHaveBeenCalled();
});

test("converts only bounded safe Jupyter output", () => {
  expect(
    notebookOutputFromMessage({
      msg_type: "display_data",
      content: {
        data: {
          "application/javascript": "window.pwned = true",
          "text/html": "<script>window.pwned = true</script>",
          "text/plain": "safe text",
        },
      },
    } as any),
  ).toEqual({
    data: {
      "text/html": "[unsafe rich output omitted]",
      "text/plain": "safe text",
    },
    execution_count: null,
    metadata: {},
    output_type: "display_data",
  });

  const output = notebookOutputFromMessage({
    msg_type: "stream",
    content: { name: "stdout", text: "x".repeat(100_100) },
  } as any);
  expect(`${output?.text}`).toHaveLength(100_019);
  expect(`${output?.text}`.endsWith("[output truncated]")).toBe(true);
});
