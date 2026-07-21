/** @jest-environment jsdom */

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {},
}));

jest.mock("../widgets/manager", () => ({
  WidgetManager: class WidgetManager {},
}));

import { JupyterActions } from "../browser-actions";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolve0) => {
    resolve = resolve0;
  });
  return { promise, resolve };
}

describe("JupyterActions nbconvert", () => {
  it("starts the project-side notebook controller before publishing export", async () => {
    const backend = deferred();
    const target: any = {
      initBackend: jest.fn(() => backend.promise),
      is_closed: jest.fn(() => false),
      nbconvert_has_started: jest.fn(() => false),
      nbconvertToHtml: jest.fn(),
      set_runtime_nbconvert: jest.fn(),
      setState: jest.fn(),
      syncdb: {},
    };

    JupyterActions.prototype.nbconvert.call(target, ["--to", "script"]);

    expect(target.setState).toHaveBeenCalledWith({
      nbconvert: expect.objectContaining({
        get: expect.any(Function),
      }),
    });
    expect(target.initBackend).toHaveBeenCalledTimes(1);
    expect(target.set_runtime_nbconvert).not.toHaveBeenCalled();

    backend.resolve();
    await backend.promise;
    await Promise.resolve();

    expect(target.set_runtime_nbconvert).toHaveBeenCalledWith({
      args: ["--to", "script"],
      error: null,
      state: "start",
    });
  });
});
