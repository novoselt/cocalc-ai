/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { kernel as createJupyterKernel } from "@cocalc/jupyter/kernel";
import { JupyterActions } from "./project-actions";

jest.mock("@cocalc/jupyter/kernel", () => ({ kernel: jest.fn() }));

// The kernel emits "kernel_error" when it fails, but the project has to relay
// that into the runtime settings record for the frontend to show anything.

function createActions() {
  const actions = new JupyterActions("kernel-error-test", {} as any) as any;
  actions._state = "ready";
  actions.set_runtime_settings = jest.fn();
  actions.save_asap = jest.fn();
  return actions;
}

describe("project-side kernel construction", () => {
  it("subscribes to the kernel's failure and state events", () => {
    const on = jest.fn();
    (createJupyterKernel as jest.Mock).mockReturnValue({ on, name: "python3" });
    const actions = createActions();
    actions.store = { get: () => "python3" };

    actions.ensureKernelIsReady();

    expect(on.mock.calls.map(([event]) => event).sort()).toEqual([
      "kernel_error",
      "state",
    ]);
  });
});

describe("project-side kernel error lifecycle", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("relays a kernel failure into the runtime settings", () => {
    const actions = createActions();

    actions.handleKernelError("kernel died");

    expect(actions.set_runtime_settings).toHaveBeenCalledWith({
      kernel_error: "kernel died",
    });
  });

  it("clears the error once the kernel holds running", () => {
    const actions = createActions();

    actions.handleKernelBackendState("running");
    expect(actions.set_runtime_settings).not.toHaveBeenCalled();
    jest.advanceTimersByTime(3000);

    expect(actions.set_runtime_settings).toHaveBeenCalledWith({
      kernel_error: "",
    });
  });

  it("cancels the pending clear when the kernel leaves running", () => {
    const actions = createActions();

    actions.handleKernelBackendState("running");
    actions.handleKernelBackendState("failed");
    jest.advanceTimersByTime(3000);

    expect(actions.set_runtime_settings).not.toHaveBeenCalled();
  });

  it("does not clear an error after the actions are closed", () => {
    const actions = createActions();

    actions.handleKernelBackendState("running");
    actions._state = "closed";
    jest.advanceTimersByTime(3000);

    expect(actions.set_runtime_settings).not.toHaveBeenCalled();
  });

  it("drops a pending clear on close", () => {
    const actions = createActions();

    actions.handleKernelBackendState("running");
    actions.close_project_only();
    jest.advanceTimersByTime(3000);

    expect(actions.set_runtime_settings).not.toHaveBeenCalled();
  });
});
