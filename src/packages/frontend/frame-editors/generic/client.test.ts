jest.mock("@cocalc/frontend/app-framework", () => ({
  redux: {
    getActions: jest.fn(),
    getStore: jest.fn(),
  },
}));

const mockString = jest.fn(() => ({ kind: "syncstring" }));
const mockDb = jest.fn(() => ({ kind: "syncdb" }));
const mockImmer = jest.fn(() => ({ kind: "immerdb" }));
const mockProjectExec = jest.fn();
const mockProjectConatSync = jest.fn(() => ({
  sync: {
    string: mockString,
    db: mockDb,
    immer: mockImmer,
  },
}));

jest.mock("@cocalc/frontend/webapp-client", () => ({
  webapp_client: {
    conat_client: {
      projectConatSync: mockProjectConatSync,
    },
    project_client: { exec: mockProjectExec },
    time_client: {},
    tracking_client: {},
  },
}));

describe("generic editor syncdoc client routing", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockProjectExec.mockReset();
  });

  it("opens syncstrings through the project-scoped Conat client", () => {
    const { syncstring2 } = require("./client");

    syncstring2({
      project_id: "00000000-0000-4000-8000-000000000001",
      path: "/a.txt",
    });

    expect(mockProjectConatSync).toHaveBeenCalledWith({
      project_id: "00000000-0000-4000-8000-000000000001",
      caller: "syncstring2",
      requireRouting: false,
    });
    expect(mockString).toHaveBeenCalledWith({
      project_id: "00000000-0000-4000-8000-000000000001",
      path: "/a.txt",
    });
  });

  it("opens structured syncdocs through the project-scoped Conat client", () => {
    const { syncdb2, immerdb2 } = require("./client");

    syncdb2({
      project_id: "00000000-0000-4000-8000-000000000002",
      path: "/a.ipynb",
      primary_keys: ["id"],
    });
    immerdb2({
      project_id: "00000000-0000-4000-8000-000000000003",
      path: "/a.chat",
      primary_keys: ["id"],
    });

    expect(mockProjectConatSync).toHaveBeenCalledWith({
      project_id: "00000000-0000-4000-8000-000000000002",
      caller: "syncdb2",
      requireRouting: false,
    });
    expect(mockProjectConatSync).toHaveBeenCalledWith({
      project_id: "00000000-0000-4000-8000-000000000003",
      caller: "immerdb2",
      requireRouting: false,
    });
    expect(mockDb).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "00000000-0000-4000-8000-000000000002",
        path: "/a.ipynb",
      }),
    );
    expect(mockImmer).toHaveBeenCalledWith(
      expect.objectContaining({
        project_id: "00000000-0000-4000-8000-000000000003",
        path: "/a.chat",
      }),
    );
  });

  it("cancels an async job through the authoritative backend API", async () => {
    const { cancel_exec_job } = require("./client");
    const killed = {
      type: "async",
      job_id: "job-1",
      status: "killed",
      start: 1,
      stdout: "",
      stderr: "",
      exit_code: 1,
      time: 1,
    };
    mockProjectExec.mockResolvedValue(killed);

    await expect(
      cancel_exec_job({
        project_id: "project-1",
        job: { ...killed, status: "running", pid: 123 },
      }),
    ).resolves.toEqual(killed);
    expect(mockProjectExec).toHaveBeenCalledTimes(1);
    expect(mockProjectExec).toHaveBeenCalledWith({
      project_id: "project-1",
      async_cancel: "job-1",
    });
  });

  it("falls back to process-group kill for an older project backend", async () => {
    const { cancel_exec_job } = require("./client");
    mockProjectExec
      .mockRejectedValueOnce(new Error("async_cancel is not supported"))
      .mockResolvedValueOnce({
        type: "blocking",
        stdout: "",
        stderr: "",
        exit_code: 0,
        time: 1,
      });

    const result = await cancel_exec_job({
      project_id: "project-1",
      job: {
        type: "async",
        job_id: "job-1",
        status: "running",
        start: 1,
        pid: 123,
        stdout: "",
        stderr: "",
        exit_code: 0,
        time: 1,
      },
    });

    expect(mockProjectExec).toHaveBeenNthCalledWith(2, {
      project_id: "project-1",
      command: "kill -9 -123",
      bash: true,
      err_on_exit: false,
    });
    expect(result).toMatchObject({ status: "killed", exit_code: 1 });
  });
});
