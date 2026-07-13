export {};

let createServiceClientMock: jest.Mock;
let createServiceHandlerMock: jest.Mock;

jest.mock("@cocalc/conat/service/typed", () => ({
  __esModule: true,
  createServiceClient: (...args: any[]) => createServiceClientMock(...args),
  createServiceHandler: (...args: any[]) => createServiceHandlerMock(...args),
}));

describe("createHostControlClient", () => {
  beforeEach(() => {
    jest.resetModules();
    createServiceClientMock = jest.fn(() => ({ kind: "host-control-client" }));
    createServiceHandlerMock = jest.fn(() => ({
      kind: "host-control-service",
    }));
  });

  it("uses request transport when timeout exceeds MAX_INTEREST_TIMEOUT", async () => {
    const { MAX_INTEREST_TIMEOUT } = await import("@cocalc/conat/core/client");
    const { createHostControlClient } = await import("./api");

    createHostControlClient({
      host_id: "host-1",
      client: {} as any,
      timeout: MAX_INTEREST_TIMEOUT + 1,
    });

    expect(createServiceClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "project-host",
        subject: "project-host.host-1.api",
        timeout: MAX_INTEREST_TIMEOUT + 1,
        transport: "request",
      }),
    );
  });

  it("keeps fast-rpc transport for short host control calls", async () => {
    const { MAX_INTEREST_TIMEOUT } = await import("@cocalc/conat/core/client");
    const { createHostControlClient } = await import("./api");

    createHostControlClient({
      host_id: "host-1",
      client: {} as any,
      timeout: MAX_INTEREST_TIMEOUT,
    });

    expect(createServiceClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "project-host",
        subject: "project-host.host-1.api",
        timeout: MAX_INTEREST_TIMEOUT,
        transport: undefined,
      }),
    );
  });
});

describe("createHostControlService", () => {
  beforeEach(() => {
    jest.resetModules();
    createServiceClientMock = jest.fn();
    createServiceHandlerMock = jest.fn(() => ({
      kind: "host-control-service",
    }));
  });

  it("dispatches long-running host control requests concurrently with a bound", async () => {
    const { createHostControlService } = await import("./api");
    const client = {} as any;
    const impl = {} as any;

    createHostControlService({ host_id: "host-1", client, impl });

    expect(createServiceHandlerMock).toHaveBeenCalledWith(
      expect.objectContaining({
        service: "project-host",
        subject: "project-host.host-1.api",
        client,
        impl,
        parallel: true,
        maxParallelHandlers: 64,
      }),
    );
  });
});
