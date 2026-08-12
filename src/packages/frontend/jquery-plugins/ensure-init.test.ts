const init = jest.fn();
let surfaceReadyListener: (() => void) | undefined;

jest.mock("./index", () => ({ init }));
jest.mock("jquery-tooltip/jquery.tooltip", () => ({}));
jest.mock("timeago", () => ({}));
jest.mock("jquery.scrollintoview/jquery.scrollintoview", () => ({}));
jest.mock("@cocalc/frontend/app/surface-ready-state", () => ({
  onSignedInSurfaceReady: (listener: () => void) => {
    surfaceReadyListener = listener;
    return jest.fn();
  },
}));

describe("post-surface jQuery plugins", () => {
  beforeEach(() => {
    jest.resetModules();
    init.mockReset();
    surfaceReadyListener = undefined;
  });

  it("does not initialize before the useful surface and deduplicates loading", async () => {
    const { ensureJqueryPluginsInitialized, installPostSurfaceJqueryPlugins } =
      await import("./ensure-init");
    installPostSurfaceJqueryPlugins();
    expect(init).not.toHaveBeenCalled();

    surfaceReadyListener?.();
    await Promise.all([
      ensureJqueryPluginsInitialized(),
      ensureJqueryPluginsInitialized(),
    ]);

    expect(init).toHaveBeenCalledTimes(1);
  });
});
