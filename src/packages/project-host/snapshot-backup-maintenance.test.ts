const listProjectMaintenanceSchedulesMock = jest.fn();
const getMasterConatClientMock = jest.fn();
const runScheduledSnapshotMaintenanceMock = jest.fn();
const runScheduledBackupMaintenanceMock = jest.fn();

jest.mock("@cocalc/backend/logger", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock("@cocalc/conat/project-host/api", () => ({
  __esModule: true,
  createHostStatusClient: jest.fn(() => ({
    listProjectMaintenanceSchedules: (...args: any[]) =>
      listProjectMaintenanceSchedulesMock(...args),
  })),
}));

jest.mock("./master-status", () => ({
  __esModule: true,
  getMasterConatClient: (...args: any[]) => getMasterConatClientMock(...args),
}));

jest.mock("./file-server", () => ({
  __esModule: true,
  runScheduledSnapshotMaintenance: (...args: any[]) =>
    runScheduledSnapshotMaintenanceMock(...args),
  runScheduledBackupMaintenance: (...args: any[]) =>
    runScheduledBackupMaintenanceMock(...args),
}));

describe("snapshot-backup-maintenance", () => {
  const env = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useRealTimers();
    process.env = { ...env };
    process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_MAX_MEMORY_AVAILABLE_BYTES =
      "0";
    getMasterConatClientMock.mockReturnValue({ id: "master-client" });
    listProjectMaintenanceSchedulesMock.mockResolvedValue([
      {
        project_id: "proj-1",
        last_edited: "2026-04-10T22:00:00.000Z",
        snapshots: { daily: 5 },
        backups: { disabled: true, weekly: 1 },
        max_snapshots_per_project: 8,
        max_backups_per_project: 5,
      },
      {
        project_id: "proj-2",
        last_edited: "2026-04-10T21:00:00.000Z",
        snapshots: { disabled: true },
        backups: { frequent: 12 },
        max_snapshots_per_project: 8,
        max_backups_per_project: 5,
      },
    ]);
    runScheduledSnapshotMaintenanceMock.mockResolvedValue(undefined);
    runScheduledBackupMaintenanceMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    process.env = env;
  });

  it("runs host-owned maintenance with merged defaults and skips disabled schedules", async () => {
    process.env.COCALC_PROJECT_HOST_MAINTENANCE_ACTIVE_DAYS = "2";
    process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_PARALLELISM = "2";
    const { runProjectSnapshotBackupMaintenanceSweepOnce } =
      await import("./snapshot-backup-maintenance");

    await runProjectSnapshotBackupMaintenanceSweepOnce({
      hostId: "host-1",
    });

    expect(listProjectMaintenanceSchedulesMock).toHaveBeenCalledWith({
      host_id: "host-1",
      active_days: 2,
    });
    expect(runScheduledSnapshotMaintenanceMock).toHaveBeenCalledTimes(1);
    expect(runScheduledSnapshotMaintenanceMock).toHaveBeenCalledWith({
      project_id: "proj-1",
      counts: {
        frequent: 4,
        daily: 5,
        weekly: 4,
        monthly: 2,
      },
      limit: 8,
    });
    expect(runScheduledBackupMaintenanceMock).toHaveBeenCalledTimes(1);
    expect(runScheduledBackupMaintenanceMock).toHaveBeenCalledWith({
      project_id: "proj-2",
      counts: {
        frequent: 0,
        daily: 1,
        weekly: 3,
        monthly: 4,
      },
      limit: 5,
    });
  });

  it("runs backup maintenance even when snapshot maintenance fails", async () => {
    listProjectMaintenanceSchedulesMock.mockResolvedValue([
      {
        project_id: "proj-1",
        last_edited: "2026-04-10T22:00:00.000Z",
        snapshots: {},
        backups: {},
        max_snapshots_per_project: 8,
        max_backups_per_project: 5,
      },
    ]);
    runScheduledSnapshotMaintenanceMock.mockRejectedValue(
      new Error("snapshot limit"),
    );
    const { runProjectSnapshotBackupMaintenanceSweepOnce } =
      await import("./snapshot-backup-maintenance");

    await runProjectSnapshotBackupMaintenanceSweepOnce({
      hostId: "host-1",
    });

    expect(runScheduledSnapshotMaintenanceMock).toHaveBeenCalledTimes(1);
    expect(runScheduledBackupMaintenanceMock).toHaveBeenCalledTimes(1);
    expect(runScheduledBackupMaintenanceMock).toHaveBeenCalledWith({
      project_id: "proj-1",
      counts: {
        frequent: 0,
        daily: 1,
        weekly: 3,
        monthly: 4,
      },
      limit: 5,
    });
  });

  it("reduces concurrency below preferred memory without starving maintenance", async () => {
    delete process.env
      .COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_MAX_MEMORY_AVAILABLE_BYTES;
    const { _test, runProjectSnapshotBackupMaintenanceSweepOnce } =
      await import("./snapshot-backup-maintenance");

    expect(
      _test.maintenanceMemoryDecision({
        configuredParallelism: 4,
        meminfoText:
          "MemTotal:       65536000 kB\nMemAvailable:    6291456 kB\n",
        pressureText: "full avg10=0.00 avg60=0.00 avg300=0.00 total=0\n",
      }),
    ).toMatchObject({
      skip: false,
      parallelism: 1,
      availableBytes: 6 * 1024 ** 3,
      preferredBytes: 16_777_216_000,
      hardMinBytes: 4 * 1024 ** 3,
    });
    expect(
      _test.maintenanceMemoryDecision({
        configuredParallelism: 4,
        meminfoText:
          "MemTotal:       65536000 kB\nMemAvailable:   20971520 kB\n",
        pressureText: "full avg10=0.00 avg60=0.00 avg300=0.00 total=0\n",
      }),
    ).toMatchObject({
      skip: false,
      parallelism: 4,
      availableBytes: 20 * 1024 ** 3,
      preferredBytes: 16_777_216_000,
    });

    const readFileSyncSpy = jest
      .spyOn(require("node:fs"), "readFileSync")
      .mockImplementation((path: unknown) =>
        `${path}` === "/proc/pressure/memory"
          ? "full avg10=0.00 avg60=0.00 avg300=0.00 total=0\n"
          : "MemTotal:       65536000 kB\nMemAvailable:    6291456 kB\n",
      );
    try {
      await runProjectSnapshotBackupMaintenanceSweepOnce({
        hostId: "host-1",
      });
    } finally {
      readFileSyncSpy.mockRestore();
    }

    expect(listProjectMaintenanceSchedulesMock).toHaveBeenCalled();
    expect(runScheduledSnapshotMaintenanceMock).toHaveBeenCalled();
    expect(runScheduledBackupMaintenanceMock).toHaveBeenCalled();
  });

  it("skips maintenance below the hard floor or under sustained memory pressure", async () => {
    delete process.env
      .COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_MAX_MEMORY_AVAILABLE_BYTES;
    const { _test } = await import("./snapshot-backup-maintenance");

    expect(
      _test.maintenanceMemoryDecision({
        configuredParallelism: 4,
        meminfoText:
          "MemTotal:       65536000 kB\nMemAvailable:    3145728 kB\n",
        pressureText: "full avg10=0.00 avg60=0.00 avg300=0.00 total=0\n",
      }),
    ).toMatchObject({
      skip: true,
      reason: "available_memory",
      hardMinBytes: 4 * 1024 ** 3,
    });
    expect(
      _test.maintenanceMemoryDecision({
        configuredParallelism: 4,
        meminfoText:
          "MemTotal:       65536000 kB\nMemAvailable:   20971520 kB\n",
        pressureText: "full avg10=7.50 avg60=3.00 avg300=1.00 total=1\n",
      }),
    ).toMatchObject({
      skip: true,
      reason: "memory_pressure",
      pressureFullAvg10: 7.5,
    });
  });

  it("starts a repeating timer and can be stopped", () => {
    jest.useFakeTimers();
    process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_SWEEP_MS = "60000";
    process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_INITIAL_DELAY_MS = "0";
    const {
      startProjectSnapshotBackupMaintenance,
    } = require("./snapshot-backup-maintenance");
    const stop = startProjectSnapshotBackupMaintenance({ hostId: "host-1" });
    jest.runOnlyPendingTimers();
    jest.advanceTimersByTime(60_000);
    stop();
    jest.advanceTimersByTime(60_000);
    expect(listProjectMaintenanceSchedulesMock).toHaveBeenCalled();
  });

  it("defers the first sweep until the configured delay", () => {
    jest.useFakeTimers();
    process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_INITIAL_DELAY_MS = "30000";
    process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_SWEEP_MS = "60000";
    const {
      startProjectSnapshotBackupMaintenance,
    } = require("./snapshot-backup-maintenance");

    const stop = startProjectSnapshotBackupMaintenance({ hostId: "host-1" });
    expect(listProjectMaintenanceSchedulesMock).not.toHaveBeenCalled();

    jest.advanceTimersByTime(29_999);
    expect(listProjectMaintenanceSchedulesMock).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(listProjectMaintenanceSchedulesMock).toHaveBeenCalledTimes(1);

    stop();
  });

  it("can disable maintenance entirely", () => {
    jest.useFakeTimers();
    process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_DISABLE = "true";
    process.env.COCALC_PROJECT_HOST_SNAPSHOT_BACKUP_INITIAL_DELAY_MS = "0";
    const {
      startProjectSnapshotBackupMaintenance,
    } = require("./snapshot-backup-maintenance");

    const stop = startProjectSnapshotBackupMaintenance({ hostId: "host-1" });
    jest.runOnlyPendingTimers();
    jest.advanceTimersByTime(5 * 60_000);
    stop();

    expect(listProjectMaintenanceSchedulesMock).not.toHaveBeenCalled();
    expect(runScheduledSnapshotMaintenanceMock).not.toHaveBeenCalled();
    expect(runScheduledBackupMaintenanceMock).not.toHaveBeenCalled();
  });
});
