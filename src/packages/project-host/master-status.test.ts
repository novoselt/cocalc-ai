const reportHostProvisionedInventoryMock = jest.fn();

const loggerFactory = jest.fn(() => ({
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
}));

jest.mock("@cocalc/backend/logger", () => ({
  __esModule: true,
  default: loggerFactory,
  getLogger: loggerFactory,
}));

jest.mock("@cocalc/conat/project-host/api", () => ({
  __esModule: true,
  createHostStatusClient: jest.fn(() => ({
    reportHostProvisionedInventory: (...args: any[]) =>
      reportHostProvisionedInventoryMock(...args),
  })),
}));

jest.mock("@cocalc/lite/hub/acp", () => ({
  __esModule: true,
  clearLocalAcpAutomationsForProject: jest.fn(),
}));

jest.mock("./sqlite/projects", () => ({
  __esModule: true,
  listUnreportedProjects: jest.fn(() => []),
  markProjectStateReported: jest.fn(),
  deleteProjectLocal: jest.fn(),
}));

jest.mock("./sqlite/provisioning", () => ({
  __esModule: true,
  listUnreportedProvisioning: jest.fn(() => []),
  markProjectProvisionedReported: jest.fn(),
  setProjectProvisioned: jest.fn(() => true),
  deleteProjectProvisioning: jest.fn(),
}));

jest.mock("./sqlite/account-revocations", () => ({
  __esModule: true,
  getRevocationSyncCursor: jest.fn(() => ({ updated_ms: 0, account_id: "" })),
  setRevocationSyncCursor: jest.fn(),
  upsertAccountRevocation: jest.fn(),
}));

jest.mock("./last-edited", () => ({
  __esModule: true,
  reportPendingProjectTouches: jest.fn(async () => undefined),
}));

jest.mock("./file-server", () => ({
  __esModule: true,
  deleteVolume: jest.fn(async () => undefined),
}));

jest.mock("./rpc-traffic-audit", () => ({
  __esModule: true,
  recordProjectHostRpcTraffic: jest.fn(),
}));

describe("master-status provisioned inventory", () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    jest.useRealTimers();
    reportHostProvisionedInventoryMock.mockResolvedValue({
      delete_project_ids: [],
    });
    const { resetMasterStatusForTests } = await import("./master-status");
    resetMasterStatusForTests();
  });

  afterEach(async () => {
    const { resetMasterStatusForTests } = await import("./master-status");
    resetMasterStatusForTests();
    jest.useRealTimers();
  });

  it("reports a de-duplicated provisioned inventory immediately and periodically", async () => {
    jest.useFakeTimers();
    const { setMasterStatusClient, startProvisionedInventoryReporter } =
      await import("./master-status");
    setMasterStatusClient({
      client: {} as any,
      host_id: "host-1",
    });
    const listProjectIds = jest.fn(async () => [
      "project-1",
      "project-1",
      "project-2",
      "",
    ]);

    const stop = startProvisionedInventoryReporter({
      listProjectIds,
      intervalMs: 60_000,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(reportHostProvisionedInventoryMock).toHaveBeenCalledTimes(1);
    expect(reportHostProvisionedInventoryMock).toHaveBeenCalledWith({
      host_id: "host-1",
      host: undefined,
      project_ids: ["project-1", "project-2"],
      checked_at: expect.any(Number),
    });

    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(reportHostProvisionedInventoryMock).toHaveBeenCalledTimes(2);

    stop();
    jest.advanceTimersByTime(60_000);
    await Promise.resolve();
    await Promise.resolve();
    expect(reportHostProvisionedInventoryMock).toHaveBeenCalledTimes(2);
  });

  it("does not report an empty inventory when listing provisioned projects fails", async () => {
    const { setMasterStatusClient, startProvisionedInventoryReporter } =
      await import("./master-status");
    setMasterStatusClient({
      client: {} as any,
      host_id: "host-1",
    });
    const stop = startProvisionedInventoryReporter({
      listProjectIds: async () => {
        throw new Error("btrfs list failed");
      },
      intervalMs: 60_000,
    });
    await Promise.resolve();
    await Promise.resolve();
    stop();

    expect(reportHostProvisionedInventoryMock).not.toHaveBeenCalled();
  });
});
