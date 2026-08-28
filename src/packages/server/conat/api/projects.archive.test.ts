export {};

let isAdminMock: jest.Mock;
let poolQueryMock: jest.Mock;
let poolConnectQueryMock: jest.Mock;
let poolConnectReleaseMock: jest.Mock;
let resolveProjectBayMock: jest.Mock;
let interBayStopMock: jest.Mock;
let deleteProjectDataOnHostMock: jest.Mock;
let deleteProjectDataOnHostAfterBackupMock: jest.Mock;
let releaseProjectDataArchiveFreezeOnHostMock: jest.Mock;
let appendProjectOutboxEventForProjectMock: jest.Mock;
let assertProjectNotRehomingMock: jest.Mock;
let publishProjectAccountFeedEventsBestEffortMock: jest.Mock;
let routedClientCloseMock: jest.Mock;
let getExplicitProjectRoutedClientMock: jest.Mock;
let assertCanPerformDestructiveStorageActionMock: jest.Mock;
let createProjectArchiveLifecycleJobMock: jest.Mock;
let updateProjectArchiveLifecycleJobMock: jest.Mock;
let getProjectArchiveLifecycleFinalBackupMock: jest.Mock;
let recordProjectArchiveLifecycleFinalBackupMock: jest.Mock;
let clearProjectArchiveLifecycleFinalBackupMock: jest.Mock;
let createBackupMock: jest.Mock;
let waitForDurableLroCompletionMock: jest.Mock;

jest.mock("@cocalc/backend/conat", () => ({
  __esModule: true,
  conat: jest.fn(() => ({ name: "test-conat-client" })),
}));

jest.mock("@cocalc/server/conat/api/project-backups", () => ({
  __esModule: true,
  createBackup: (...args: any[]) => createBackupMock(...args),
}));

jest.mock("@cocalc/server/lro/wait", () => ({
  __esModule: true,
  waitForDurableLroCompletion: (...args: any[]) =>
    waitForDurableLroCompletionMock(...args),
}));

jest.mock("@cocalc/server/projects/archive-lifecycle-db", () => ({
  __esModule: true,
  createProjectArchiveLifecycleJob: (...args: any[]) =>
    createProjectArchiveLifecycleJobMock(...args),
  updateProjectArchiveLifecycleJob: (...args: any[]) =>
    updateProjectArchiveLifecycleJobMock(...args),
  getProjectArchiveLifecycleFinalBackup: (...args: any[]) =>
    getProjectArchiveLifecycleFinalBackupMock(...args),
  recordProjectArchiveLifecycleFinalBackup: (...args: any[]) =>
    recordProjectArchiveLifecycleFinalBackupMock(...args),
  clearProjectArchiveLifecycleFinalBackup: (...args: any[]) =>
    clearProjectArchiveLifecycleFinalBackupMock(...args),
}));

jest.mock("@cocalc/server/projects/create", () => ({
  __esModule: true,
  default: jest.fn(),
}));

jest.mock("@cocalc/backend/logger", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
  getLogger: jest.fn(() => ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  })),
}));

jest.mock("@cocalc/server/accounts/is-admin", () => ({
  __esModule: true,
  default: (...args: any[]) => isAdminMock(...args),
}));

jest.mock("@cocalc/server/projects/collaborators", () => ({
  __esModule: true,
}));

jest.mock("@cocalc/conat/files/file-server", () => ({
  __esModule: true,
  client: jest.fn(),
}));

jest.mock("@cocalc/database/pool", () => ({
  __esModule: true,
  default: jest.fn(() => ({
    query: (...args: any[]) => poolQueryMock(...args),
    connect: async () => ({
      query: (...args: any[]) => poolConnectQueryMock(...args),
      release: (...args: any[]) => poolConnectReleaseMock(...args),
    }),
  })),
}));

jest.mock("@cocalc/database", () => ({
  __esModule: true,
  db: jest.fn(() => ({})),
}));

jest.mock("@cocalc/server/project-host/control", () => ({
  __esModule: true,
  updateAuthorizedKeysOnHost: jest.fn(),
  takeStartProjectPhaseTimings: jest.fn(() => undefined),
  deleteProjectDataOnHost: (...args: any[]) =>
    deleteProjectDataOnHostMock(...args),
  deleteProjectDataOnHostAfterBackup: (...args: any[]) =>
    deleteProjectDataOnHostAfterBackupMock(...args),
  releaseProjectDataArchiveFreezeOnHost: (...args: any[]) =>
    releaseProjectDataArchiveFreezeOnHostMock(...args),
}));

jest.mock("@cocalc/server/conat/route-client", () => ({
  __esModule: true,
  getExplicitProjectRoutedClient: (...args: any[]) =>
    getExplicitProjectRoutedClientMock(...args),
  conatWithProjectRoutingForAccount: jest.fn(() => ({
    close: (...args: any[]) => routedClientCloseMock(...args),
  })),
}));

jest.mock("@cocalc/server/inter-bay/directory", () => ({
  __esModule: true,
  resolveProjectBay: (...args: any[]) => resolveProjectBayMock(...args),
}));

jest.mock("@cocalc/server/inter-bay/bridge", () => ({
  __esModule: true,
  getInterBayBridge: jest.fn(() => ({
    projectControl: jest.fn(() => ({
      stop: (...args: any[]) => interBayStopMock(...args),
    })),
  })),
}));

jest.mock("@cocalc/server/projects/copy-db", () => ({
  __esModule: true,
  cancelCopy: jest.fn(),
  listCopiesForProject: jest.fn(async () => []),
}));

jest.mock("@cocalc/server/lro/lro-db", () => ({
  __esModule: true,
  createLro: jest.fn(),
  updateLro: jest.fn(),
}));

jest.mock("@cocalc/server/projects/start-lro-progress", () => ({
  __esModule: true,
  mirrorStartLroProgress: jest.fn(),
}));

jest.mock("@cocalc/server/projects/start-lro-cleanup", () => ({
  __esModule: true,
  supersedeOlderProjectStartLros: jest.fn(),
}));

jest.mock("@cocalc/server/lro/stream", () => ({
  __esModule: true,
  publishLroEvent: jest.fn(),
  publishLroSummary: jest.fn(),
}));

jest.mock("@cocalc/conat/lro/names", () => ({
  __esModule: true,
  lroStreamName: jest.fn(),
}));

jest.mock("@cocalc/conat/persist/util", () => ({
  __esModule: true,
  SERVICE: "persist-service",
}));

jest.mock("@cocalc/database/postgres/project-events-outbox", () => ({
  __esModule: true,
  appendProjectOutboxEventForProject: (...args: any[]) =>
    appendProjectOutboxEventForProjectMock(...args),
}));

jest.mock("@cocalc/database/postgres/project-rehome-fence", () => ({
  __esModule: true,
  assertProjectNotRehoming: (...args: any[]) =>
    assertProjectNotRehomingMock(...args),
  withProjectRehomeWriteFence: jest.fn(),
}));

jest.mock("@cocalc/server/account/project-feed", () => ({
  __esModule: true,
  publishProjectAccountFeedEventsBestEffort: (...args: any[]) =>
    publishProjectAccountFeedEventsBestEffortMock(...args),
}));

jest.mock("@cocalc/server/account/project-detail-feed", () => ({
  __esModule: true,
  publishProjectDetailInvalidationBestEffort: jest.fn(),
}));

jest.mock("@cocalc/server/projects/destructive-storage-actions", () => ({
  __esModule: true,
  assertCanPerformDestructiveStorageAction: (...args: any[]) =>
    assertCanPerformDestructiveStorageActionMock(...args),
}));

jest.mock("./util", () => ({
  __esModule: true,
  assertCollab: jest.fn(),
  assertCollabAllowRemoteProjectAccess: jest.fn(),
}));

describe("projects.archiveProject", () => {
  beforeEach(() => {
    jest.resetModules();
    isAdminMock = jest.fn(async () => false);
    poolQueryMock = jest.fn();
    poolConnectQueryMock = jest.fn(async (sql: string) => {
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") {
        return { rowCount: 0 };
      }
      return { rowCount: 1, rows: [] };
    });
    poolConnectReleaseMock = jest.fn();
    resolveProjectBayMock = jest.fn(async () => ({
      bay_id: "bay-1",
      epoch: 7,
    }));
    interBayStopMock = jest.fn(async () => undefined);
    deleteProjectDataOnHostMock = jest.fn(async () => undefined);
    deleteProjectDataOnHostAfterBackupMock = jest.fn(async () => undefined);
    releaseProjectDataArchiveFreezeOnHostMock = jest.fn(async () => ({
      status: "released",
    }));
    appendProjectOutboxEventForProjectMock = jest.fn(async () => undefined);
    assertProjectNotRehomingMock = jest.fn(async () => undefined);
    publishProjectAccountFeedEventsBestEffortMock = jest.fn(
      async () => undefined,
    );
    routedClientCloseMock = jest.fn();
    getExplicitProjectRoutedClientMock = jest.fn(async () => ({
      close: (...args: any[]) => routedClientCloseMock(...args),
    }));
    assertCanPerformDestructiveStorageActionMock = jest.fn(
      async () => undefined,
    );
    createProjectArchiveLifecycleJobMock = jest.fn(async () => ({
      id: "77777777-7777-4777-8777-777777777777",
    }));
    updateProjectArchiveLifecycleJobMock = jest.fn(async () => undefined);
    getProjectArchiveLifecycleFinalBackupMock = jest.fn(async () => undefined);
    recordProjectArchiveLifecycleFinalBackupMock = jest.fn(
      async () => undefined,
    );
    clearProjectArchiveLifecycleFinalBackupMock = jest.fn(
      async () => undefined,
    );
    createBackupMock = jest.fn(async () => ({
      op_id: "88888888-8888-4888-8888-888888888888",
      scope_type: "project",
      scope_id: "11111111-1111-4111-8111-111111111111",
    }));
    waitForDurableLroCompletionMock = jest.fn(async () => ({
      status: "succeeded",
      result: {
        id: "final-backup-id",
        time: "2026-06-15T05:30:00.000Z",
        generation: 10,
      },
    }));
  });

  it("archives a provisioned project with durable backup metadata", async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [
        {
          host_id: "host-1",
          backup_repo_id: "repo-1",
          provisioned: true,
          state: { state: "running" },
          host_status: "running",
          last_backup: new Date("2026-06-15T04:32:34.102Z"),
        },
      ],
    });

    const { archiveProject } = await import("./projects");
    await expect(
      archiveProject({
        account_id: "owner-1",
        project_id: "proj-1",
      }),
    ).resolves.toBeUndefined();

    expect(assertCanPerformDestructiveStorageActionMock).toHaveBeenCalledWith({
      account_id: "owner-1",
      project_id: "proj-1",
      action: "archive this project",
    });
    expect(getExplicitProjectRoutedClientMock).not.toHaveBeenCalled();
    expect(resolveProjectBayMock).toHaveBeenCalledWith("proj-1");
    expect(interBayStopMock).toHaveBeenCalledWith({
      project_id: "proj-1",
      epoch: 7,
    });
    expect(deleteProjectDataOnHostMock).toHaveBeenCalledWith({
      project_id: "proj-1",
      host_id: "host-1",
    });
    expect(assertProjectNotRehomingMock).toHaveBeenCalledWith({
      db: expect.any(Object),
      project_id: "proj-1",
      action: "archive project",
    });
    expect(appendProjectOutboxEventForProjectMock).toHaveBeenCalledWith({
      db: expect.any(Object),
      event_type: "project.state_changed",
      project_id: "proj-1",
      default_bay_id: expect.any(String),
    });
    expect(publishProjectAccountFeedEventsBestEffortMock).toHaveBeenCalledWith({
      project_id: "proj-1",
      default_bay_id: expect.any(String),
    });
    expect(routedClientCloseMock).not.toHaveBeenCalled();
  });

  it("refuses to archive when no backups exist yet", async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [
        {
          host_id: "host-1",
          backup_repo_id: "repo-1",
          provisioned: true,
          state: { state: "opened" },
          host_status: "running",
        },
      ],
    });
    const { archiveProject } = await import("./projects");
    await expect(
      archiveProject({
        account_id: "owner-1",
        project_id: "proj-1",
      }),
    ).rejects.toThrow(
      "project must have at least one backup before it can be archived",
    );

    expect(deleteProjectDataOnHostMock).not.toHaveBeenCalled();
    expect(poolConnectQueryMock).not.toHaveBeenCalledWith(
      expect.stringContaining("UPDATE projects"),
      expect.anything(),
    );
  });

  it("archives a deprovisioned host without reading backups or deleting host data", async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [
        {
          host_id: "host-1",
          backup_repo_id: "repo-1",
          provisioned: true,
          state: { state: "opened" },
          host_status: "deprovisioned",
        },
      ],
    });

    const { archiveProject } = await import("./projects");
    await expect(
      archiveProject({
        account_id: "owner-1",
        project_id: "proj-1",
      }),
    ).resolves.toBeUndefined();

    expect(getExplicitProjectRoutedClientMock).not.toHaveBeenCalled();
    expect(interBayStopMock).not.toHaveBeenCalled();
    expect(deleteProjectDataOnHostMock).not.toHaveBeenCalled();
    expect(poolConnectQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE projects"),
      expect.anything(),
    );
  });

  it("archives an off host with existing backups without stopping or deleting host data", async () => {
    poolQueryMock.mockResolvedValueOnce({
      rows: [
        {
          host_id: "host-1",
          backup_repo_id: "repo-1",
          provisioned: true,
          state: { state: "opened" },
          host_status: "off",
          last_backup: new Date("2026-06-15T04:32:34.102Z"),
        },
      ],
    });

    const { archiveProject } = await import("./projects");
    await expect(
      archiveProject({
        account_id: "owner-1",
        project_id: "proj-1",
      }),
    ).resolves.toBeUndefined();

    expect(getExplicitProjectRoutedClientMock).not.toHaveBeenCalled();
    expect(interBayStopMock).not.toHaveBeenCalled();
    expect(deleteProjectDataOnHostMock).not.toHaveBeenCalled();
    expect(poolConnectQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE projects"),
      expect.anything(),
    );
  });

  it("automatic archive never stops and requires its current claim", async () => {
    const jobId = "77777777-7777-4777-8777-777777777777";
    poolQueryMock.mockResolvedValue({
      rows: [
        {
          project_id: "11111111-1111-4111-8111-111111111111",
          owning_bay_id: "bay-1",
          host_id: "22222222-2222-4222-8222-222222222222",
          backup_repo_id: "33333333-3333-4333-8333-333333333333",
          provisioned: true,
          state: { state: "archiving" },
          host_status: "active",
          last_changed: new Date("2026-06-15T04:00:00.000Z"),
          last_changed_generation: 10,
          last_backup: new Date("2026-06-15T05:00:00.000Z"),
          last_backup_generation: 10,
          archive_lifecycle_job_id: jobId,
        },
      ],
    });

    const { archiveProjectStorage } =
      await import("@cocalc/server/projects/archive");
    await expect(
      archiveProjectStorage({
        project_id: "11111111-1111-4111-8111-111111111111",
        mode: "automatic",
        job_id: jobId,
        reason: "free-inactive",
        expected_host_id: "22222222-2222-4222-8222-222222222222",
      }),
    ).resolves.toBeUndefined();

    expect(interBayStopMock).not.toHaveBeenCalled();
    expect(createBackupMock).toHaveBeenCalledWith(
      {
        project_id: "11111111-1111-4111-8111-111111111111",
        tags: ["automatic-project-archive-final"],
      },
      expect.objectContaining({
        skip_collab_check: true,
        skip_rootfs_portability_check: true,
        replace_oldest_at_limit: true,
        freeze_source: true,
        dedupe_key:
          "automatic-project-archive-final:77777777-7777-4777-8777-777777777777",
      }),
    );
    expect(waitForDurableLroCompletionMock).toHaveBeenCalledTimes(1);
    expect(recordProjectArchiveLifecycleFinalBackupMock).toHaveBeenCalledWith({
      job_id: jobId,
      backup_id: "final-backup-id",
      backup_generation: 10,
      backup_time: "2026-06-15T05:30:00.000Z",
      expected_previous_backup_id: null,
    });
    expect(
      recordProjectArchiveLifecycleFinalBackupMock.mock.invocationCallOrder[0],
    ).toBeLessThan(
      deleteProjectDataOnHostAfterBackupMock.mock.invocationCallOrder[0],
    );
    expect(deleteProjectDataOnHostAfterBackupMock).toHaveBeenCalledWith({
      project_id: "11111111-1111-4111-8111-111111111111",
      host_id: "22222222-2222-4222-8222-222222222222",
      expected_generation: 10,
    });
    expect(deleteProjectDataOnHostMock).not.toHaveBeenCalled();
  });

  it("automatic archive retries cleanup without backing up a deleted volume", async () => {
    const jobId = "77777777-7777-4777-8777-777777777777";
    getProjectArchiveLifecycleFinalBackupMock.mockResolvedValueOnce({
      id: "final-backup-id",
      generation: 10,
      time: "2026-06-15T05:30:00.000Z",
    });
    poolQueryMock.mockResolvedValue({
      rows: [
        {
          project_id: "11111111-1111-4111-8111-111111111111",
          owning_bay_id: "bay-1",
          host_id: "22222222-2222-4222-8222-222222222222",
          backup_repo_id: "33333333-3333-4333-8333-333333333333",
          provisioned: true,
          state: { state: "archiving" },
          host_status: "active",
          last_changed: new Date("2026-06-15T04:00:00.000Z"),
          last_changed_generation: 10,
          last_backup: new Date("2026-06-15T05:00:00.000Z"),
          last_backup_generation: 10,
          archive_lifecycle_job_id: jobId,
        },
      ],
    });

    const { archiveProjectStorage } =
      await import("@cocalc/server/projects/archive");
    await expect(
      archiveProjectStorage({
        project_id: "11111111-1111-4111-8111-111111111111",
        mode: "automatic",
        job_id: jobId,
        reason: "free-inactive",
        expected_host_id: "22222222-2222-4222-8222-222222222222",
      }),
    ).resolves.toBeUndefined();

    expect(createBackupMock).not.toHaveBeenCalled();
    expect(waitForDurableLroCompletionMock).not.toHaveBeenCalled();
    expect(recordProjectArchiveLifecycleFinalBackupMock).not.toHaveBeenCalled();
    expect(deleteProjectDataOnHostAfterBackupMock).toHaveBeenCalledTimes(1);
  });

  it("finalizes from a persisted final backup when the host is unavailable", async () => {
    const jobId = "77777777-7777-4777-8777-777777777777";
    getProjectArchiveLifecycleFinalBackupMock.mockResolvedValueOnce({
      id: "final-backup-id",
      generation: 10,
      time: "2026-06-15T05:30:00.000Z",
    });
    poolQueryMock.mockResolvedValue({
      rows: [
        {
          project_id: "11111111-1111-4111-8111-111111111111",
          owning_bay_id: "bay-1",
          host_id: "22222222-2222-4222-8222-222222222222",
          backup_repo_id: "33333333-3333-4333-8333-333333333333",
          provisioned: true,
          state: { state: "archiving" },
          host_status: "off",
          last_changed: new Date("2026-06-15T04:00:00.000Z"),
          last_changed_generation: 10,
          last_backup: new Date("2026-06-15T05:00:00.000Z"),
          last_backup_generation: 10,
          archive_lifecycle_job_id: jobId,
        },
      ],
    });

    const { archiveProjectStorage } =
      await import("@cocalc/server/projects/archive");
    await expect(
      archiveProjectStorage({
        project_id: "11111111-1111-4111-8111-111111111111",
        mode: "automatic",
        job_id: jobId,
        reason: "free-inactive",
        expected_host_id: "22222222-2222-4222-8222-222222222222",
      }),
    ).resolves.toBeUndefined();

    expect(createBackupMock).not.toHaveBeenCalled();
    expect(deleteProjectDataOnHostAfterBackupMock).not.toHaveBeenCalled();
    expect(poolConnectQueryMock).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE projects"),
      expect.anything(),
    );
  });

  it("finalizes an already deprovisioned automatic archive without a host", async () => {
    const jobId = "77777777-7777-4777-8777-777777777777";
    poolQueryMock.mockResolvedValue({
      rows: [
        {
          project_id: "11111111-1111-4111-8111-111111111111",
          owning_bay_id: "bay-1",
          host_id: "22222222-2222-4222-8222-222222222222",
          backup_repo_id: "33333333-3333-4333-8333-333333333333",
          provisioned: false,
          state: { state: "archiving" },
          host_status: "deprovisioned",
          last_backup: new Date("2026-06-15T05:00:00.000Z"),
          archive_lifecycle_job_id: jobId,
        },
      ],
    });

    const { archiveProjectStorage } =
      await import("@cocalc/server/projects/archive");
    await expect(
      archiveProjectStorage({
        project_id: "11111111-1111-4111-8111-111111111111",
        mode: "automatic",
        job_id: jobId,
        reason: "free-inactive",
        expected_host_id: "22222222-2222-4222-8222-222222222222",
      }),
    ).resolves.toBeUndefined();

    expect(createBackupMock).not.toHaveBeenCalled();
    expect(deleteProjectDataOnHostAfterBackupMock).not.toHaveBeenCalled();
  });

  it("treats an absent volume after a lost deletion response as cleaned up", async () => {
    const jobId = "77777777-7777-4777-8777-777777777777";
    const row = {
      project_id: "11111111-1111-4111-8111-111111111111",
      owning_bay_id: "bay-1",
      host_id: "22222222-2222-4222-8222-222222222222",
      backup_repo_id: "33333333-3333-4333-8333-333333333333",
      provisioned: true,
      state: { state: "archiving" },
      host_status: "active",
      last_changed: new Date("2026-06-15T04:00:00.000Z"),
      last_changed_generation: 10,
      last_backup: new Date("2026-06-15T05:00:00.000Z"),
      last_backup_generation: 10,
      archive_lifecycle_job_id: jobId,
    };
    poolQueryMock
      .mockResolvedValueOnce({ rows: [row] })
      .mockResolvedValueOnce({ rows: [row] });
    deleteProjectDataOnHostAfterBackupMock.mockRejectedValueOnce(
      new Error("host response lost"),
    );
    releaseProjectDataArchiveFreezeOnHostMock.mockResolvedValueOnce({
      status: "absent",
    });

    const { archiveProjectStorage, ProjectArchiveStorageError } =
      await import("@cocalc/server/projects/archive");
    const error = await archiveProjectStorage({
      project_id: row.project_id,
      mode: "automatic",
      job_id: jobId,
      reason: "free-inactive",
      expected_host_id: row.host_id,
    }).catch((err) => err);

    expect(error).toBeInstanceOf(ProjectArchiveStorageError);
    expect(error.hostCleanupCompleted).toBe(true);
    expect(error.reopenSafe).toBe(false);
    expect(clearProjectArchiveLifecycleFinalBackupMock).not.toHaveBeenCalled();
  });

  it("automatic archive replaces a stale final-backup marker after reopening", async () => {
    const jobId = "77777777-7777-4777-8777-777777777777";
    getProjectArchiveLifecycleFinalBackupMock.mockResolvedValueOnce({
      id: "stale-final-backup-id",
      generation: 9,
      time: "2026-06-15T03:30:00.000Z",
    });
    poolQueryMock.mockResolvedValue({
      rows: [
        {
          project_id: "11111111-1111-4111-8111-111111111111",
          owning_bay_id: "bay-1",
          host_id: "22222222-2222-4222-8222-222222222222",
          backup_repo_id: "33333333-3333-4333-8333-333333333333",
          provisioned: true,
          state: { state: "archiving" },
          host_status: "active",
          last_changed: new Date("2026-06-15T04:00:00.000Z"),
          last_changed_generation: 10,
          last_backup: new Date("2026-06-15T05:00:00.000Z"),
          last_backup_generation: 10,
          archive_lifecycle_job_id: jobId,
        },
      ],
    });

    const { archiveProjectStorage } =
      await import("@cocalc/server/projects/archive");
    await expect(
      archiveProjectStorage({
        project_id: "11111111-1111-4111-8111-111111111111",
        mode: "automatic",
        job_id: jobId,
        reason: "free-inactive",
        expected_host_id: "22222222-2222-4222-8222-222222222222",
      }),
    ).resolves.toBeUndefined();

    expect(createBackupMock).toHaveBeenCalledTimes(1);
    expect(recordProjectArchiveLifecycleFinalBackupMock).toHaveBeenCalledWith({
      job_id: jobId,
      backup_id: "final-backup-id",
      backup_generation: 10,
      backup_time: "2026-06-15T05:30:00.000Z",
      expected_previous_backup_id: "stale-final-backup-id",
    });
    expect(deleteProjectDataOnHostAfterBackupMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["not started", { archive_freeze_recovery: "not-started" }, true],
    ["confirmed released", { archive_freeze_recovery: "released" }, true],
    ["uncertain", { archive_freeze_recovery: "uncertain" }, false],
  ])(
    "automatic archive preserves host data after a %s final-backup failure",
    async (_case, result, reopenSafe) => {
      const jobId = "77777777-7777-4777-8777-777777777777";
      poolQueryMock.mockResolvedValue({
        rows: [
          {
            project_id: "11111111-1111-4111-8111-111111111111",
            owning_bay_id: "bay-1",
            host_id: "22222222-2222-4222-8222-222222222222",
            backup_repo_id: "33333333-3333-4333-8333-333333333333",
            provisioned: true,
            state: { state: "archiving" },
            host_status: "active",
            last_changed: new Date("2026-06-15T04:00:00.000Z"),
            last_changed_generation: 10,
            last_backup: new Date("2026-06-15T05:00:00.000Z"),
            last_backup_generation: 10,
            archive_lifecycle_job_id: jobId,
          },
        ],
      });
      waitForDurableLroCompletionMock.mockResolvedValueOnce({
        status: "failed",
        error: "R2 unavailable",
        result,
      });

      const { archiveProjectStorage, ProjectArchiveStorageError } =
        await import("@cocalc/server/projects/archive");
      const error = await archiveProjectStorage({
        project_id: "11111111-1111-4111-8111-111111111111",
        mode: "automatic",
        job_id: jobId,
        reason: "free-inactive",
        expected_host_id: "22222222-2222-4222-8222-222222222222",
      }).catch((err) => err);

      expect(error).toBeInstanceOf(ProjectArchiveStorageError);
      expect(error.message).toContain(
        "final automatic archive backup failed: R2 unavailable",
      );
      expect(error.hostCleanupCompleted).toBe(false);
      expect(error.reopenSafe).toBe(reopenSafe);
      expect(deleteProjectDataOnHostMock).not.toHaveBeenCalled();
      expect(deleteProjectDataOnHostAfterBackupMock).not.toHaveBeenCalled();
      expect(releaseProjectDataArchiveFreezeOnHostMock).not.toHaveBeenCalled();
    },
  );

  it("automatic archive revalidates generation coverage after final backup", async () => {
    const jobId = "77777777-7777-4777-8777-777777777777";
    const row = {
      project_id: "11111111-1111-4111-8111-111111111111",
      owning_bay_id: "bay-1",
      host_id: "22222222-2222-4222-8222-222222222222",
      backup_repo_id: "33333333-3333-4333-8333-333333333333",
      provisioned: true,
      state: { state: "archiving" },
      host_status: "active",
      last_changed: new Date("2026-06-15T04:00:00.000Z"),
      last_changed_generation: 10,
      last_backup: new Date("2026-06-15T05:00:00.000Z"),
      last_backup_generation: 10,
      archive_lifecycle_job_id: jobId,
    };
    poolQueryMock.mockResolvedValueOnce({ rows: [row] }).mockResolvedValueOnce({
      rows: [
        {
          ...row,
          last_changed: new Date("2026-06-15T06:00:00.000Z"),
          last_changed_generation: 11,
          last_backup: new Date("2026-06-15T06:30:00.000Z"),
          last_backup_generation: 11,
        },
      ],
    });

    const { archiveProjectStorage } =
      await import("@cocalc/server/projects/archive");
    await expect(
      archiveProjectStorage({
        project_id: "11111111-1111-4111-8111-111111111111",
        mode: "automatic",
        job_id: jobId,
        reason: "free-inactive",
        expected_host_id: "22222222-2222-4222-8222-222222222222",
      }),
    ).rejects.toThrow(
      "final automatic archive backup does not cover the current filesystem generation",
    );

    expect(recordProjectArchiveLifecycleFinalBackupMock).not.toHaveBeenCalled();
    expect(deleteProjectDataOnHostMock).not.toHaveBeenCalled();
    expect(deleteProjectDataOnHostAfterBackupMock).not.toHaveBeenCalled();
    expect(releaseProjectDataArchiveFreezeOnHostMock).toHaveBeenCalledWith({
      project_id: "11111111-1111-4111-8111-111111111111",
      host_id: "22222222-2222-4222-8222-222222222222",
      expected_generation: 10,
    });
    expect(clearProjectArchiveLifecycleFinalBackupMock).toHaveBeenCalledWith({
      job_id: "77777777-7777-4777-8777-777777777777",
      backup_id: "final-backup-id",
      backup_generation: 10,
    });
  });

  it("automatic archive rejects a busy project without stopping or deleting it", async () => {
    const jobId = "77777777-7777-4777-8777-777777777777";
    poolQueryMock.mockResolvedValueOnce({
      rows: [
        {
          project_id: "11111111-1111-4111-8111-111111111111",
          owning_bay_id: "bay-1",
          host_id: "22222222-2222-4222-8222-222222222222",
          backup_repo_id: "33333333-3333-4333-8333-333333333333",
          provisioned: true,
          state: { state: "running" },
          host_status: "active",
          last_backup: new Date("2026-06-15T05:00:00.000Z"),
          archive_lifecycle_job_id: jobId,
        },
      ],
    });

    const { archiveProjectStorage } =
      await import("@cocalc/server/projects/archive");
    await expect(
      archiveProjectStorage({
        project_id: "11111111-1111-4111-8111-111111111111",
        mode: "automatic",
        job_id: jobId,
        reason: "free-inactive",
        expected_host_id: "22222222-2222-4222-8222-222222222222",
      }),
    ).rejects.toThrow("automatic archive project claim is no longer current");

    expect(interBayStopMock).not.toHaveBeenCalled();
    expect(deleteProjectDataOnHostMock).not.toHaveBeenCalled();
    expect(deleteProjectDataOnHostAfterBackupMock).not.toHaveBeenCalled();
  });
});
