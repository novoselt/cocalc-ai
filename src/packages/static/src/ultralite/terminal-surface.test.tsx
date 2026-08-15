/*
 * This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { AccountProjectListWindowRow } from "@cocalc/conat/hub/api/projects";
import type { UltraliteSession } from "./session";

jest.mock("@xterm/xterm", () => ({
  Terminal: class {
    cols = 80;
    rows = 24;
    dispose() {}
    focus() {}
    loadAddon() {}
    open(host: HTMLElement) {
      host.dataset.xtermOpened = "true";
    }
    reset() {}
    write(_data: string, callback?: () => void) {
      callback?.();
    }
    onData() {
      return { dispose: jest.fn() };
    }
    onKey() {
      return { dispose: jest.fn() };
    }
  },
}));

jest.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    fit() {}
  },
}));

jest.mock("@cocalc/conat/project/terminal", () => ({
  terminalClient: jest.fn(),
}));

const {
  terminalClient: mockTerminalClient,
} = require("@cocalc/conat/project/terminal");
const {
  default: TerminalSurface,
  writeTerminalInput,
} = require("./terminal-surface");

const project = {
  host_id: "33333333-3333-4333-8333-333333333333",
  project_id: "11111111-1111-4111-8111-111111111111",
  title: "Test project",
} as AccountProjectListWindowRow;

function makeSession(state = "stopped") {
  const socketHandlers: Record<string, (...args: any[]) => void> = {};
  const terminalHandlers: Record<string, (...args: any[]) => void> = {};
  const terminal = {
    close: jest.fn(),
    on: jest.fn((event: string, callback: (...args: any[]) => void) => {
      terminalHandlers[event] = callback;
    }),
    resize: jest.fn(async () => undefined),
    socket: {
      on: jest.fn((event: string, callback: (...args: any[]) => void) => {
        socketHandlers[event] = callback;
      }),
      state: "ready",
      write: jest.fn(),
    },
    spawn: jest.fn(async () => "prior output\r\n"),
  };
  const getProjectState = jest.fn(async () => ({ state }));
  const ensureProjectRunning = jest.fn(async (_id, onState) => {
    onState?.("Project is starting...");
  });
  const openProjectHost = jest.fn(async () => ({ client: {} }));
  mockTerminalClient.mockReturnValue(terminal);
  const session = {
    accountId: "22222222-2222-4222-8222-222222222222",
    ensureProjectRunning,
    getProjectState,
    openProjectHost,
  } as unknown as UltraliteSession;
  return {
    ensureProjectRunning,
    getProjectState,
    openProjectHost,
    session,
    socketHandlers,
    terminal,
    terminalHandlers,
  };
}

beforeAll(() => {
  Object.defineProperty(globalThis, "ResizeObserver", {
    configurable: true,
    value: class {
      disconnect = jest.fn();
      observe = jest.fn();
    },
  });
});

beforeEach(() => {
  jest.clearAllMocks();
});

test("viewing Terminal never starts project compute or creates a PTY", async () => {
  const { ensureProjectRunning, openProjectHost, session } = makeSession();
  render(<TerminalSurface project={project} session={session} />);

  await screen.findByText(/This project is stopped/);
  expect(
    screen.getByRole("application", { name: "Project terminal" }),
  ).toHaveAttribute("data-xterm-opened", "true");
  expect(
    screen.getByRole("button", { name: "Connect terminal" }),
  ).toBeEnabled();
  expect(ensureProjectRunning).not.toHaveBeenCalled();
  expect(openProjectHost).not.toHaveBeenCalled();
  expect(mockTerminalClient).not.toHaveBeenCalled();
});

test("a canceled start confirmation leaves the stopped project unchanged", async () => {
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(false);
  const { ensureProjectRunning, openProjectHost, session } = makeSession();
  render(<TerminalSurface project={project} session={session} />);
  await screen.findByText(/This project is stopped/);
  fireEvent.click(screen.getByRole("button", { name: "Connect terminal" }));

  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1));
  expect(ensureProjectRunning).not.toHaveBeenCalled();
  expect(openProjectHost).not.toHaveBeenCalled();
  expect(mockTerminalClient).not.toHaveBeenCalled();
  confirm.mockRestore();
});

test("an approved connection starts compute and uses the direct terminal client", async () => {
  const confirm = jest.spyOn(window, "confirm").mockReturnValue(true);
  const { ensureProjectRunning, openProjectHost, session, terminal } =
    makeSession();
  render(<TerminalSurface project={project} session={session} />);
  await screen.findByText(/This project is stopped/);
  fireEvent.click(screen.getByRole("button", { name: "Connect terminal" }));

  await screen.findByRole("button", { name: "Disconnect" });
  expect(ensureProjectRunning).toHaveBeenCalledWith(
    project.project_id,
    expect.any(Function),
  );
  expect(openProjectHost).toHaveBeenCalledWith(
    project.project_id,
    project.host_id,
  );
  expect(mockTerminalClient).toHaveBeenCalledWith({
    client: {},
    getSize: expect.any(Function),
    project_id: project.project_id,
    reconnection: true,
  });
  expect(terminal.spawn).toHaveBeenCalledWith("bash", [], {
    cwd: "/home/user",
    env0: { COLORTERM: "truecolor", TERM: "xterm-256color" },
    id: "ultralite-22222222-2222-4222-8222-222222222222",
    timeout: 15_000,
  });
  writeTerminalInput(terminal, "ls\r");
  expect(terminal.socket.write).toHaveBeenCalledWith({
    data: "ls\r",
    kind: "user",
  });
  writeTerminalInput(terminal, "\u001b[1;2R", "auto");
  expect(terminal.socket.write).toHaveBeenLastCalledWith({
    data: "\u001b[1;2R",
    kind: "auto",
  });
  confirm.mockRestore();
});
