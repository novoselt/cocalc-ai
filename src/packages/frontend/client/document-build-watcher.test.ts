import type { DocumentBuildSnapshot } from "@cocalc/app-document-build";
import { EventEmitter } from "events";
import {
  DocumentBuildWatcher,
  documentBuildSnapshotToEditorState,
  formatDocumentBuildError,
} from "./document-build-watcher";

const tick = async () => await new Promise((resolve) => setTimeout(resolve, 0));

function snapshot(
  seq: number,
  state: DocumentBuildSnapshot["state"] = "running",
): DocumentBuildSnapshot {
  return {
    build_id: "build-1",
    identity: {
      kind: "quarto",
      logical_path: "/home/user/docs/report.qmd",
      working_path: "/home/user/docs/report.qmd",
      resource_key: "/home/user/docs/report.qmd",
    },
    state,
    seq,
    submitted_at: 10,
    started_at: 11,
    build_timeout_ms: 60_000,
    force: false,
    stages: [],
    diagnostics: [],
    dependencies: [],
    artifacts: [],
  };
}

function subscriptionWith(
  values: Array<DocumentBuildSnapshot | { snapshot: DocumentBuildSnapshot }>,
) {
  return {
    close: jest.fn(),
    async *[Symbol.asyncIterator]() {
      for (const value of values) yield { data: value };
    },
  };
}

describe("formatDocumentBuildError", () => {
  it("suggests restarting a project that lacks the document-build service", () => {
    expect(
      formatDocumentBuildError(
        Error("no responders for project.document-build.start"),
      ),
    ).toContain("Restart the project and try again");
  });

  it("preserves ordinary document-build errors", () => {
    expect(formatDocumentBuildError(Error("source path is invalid"))).toBe(
      "Error: source path is invalid",
    );
  });
});

describe("DocumentBuildWatcher", () => {
  it("subscribes before hydrating active builds and refreshes on reconnect", async () => {
    const subscription = subscriptionWith([]);
    const client = Object.assign(new EventEmitter(), {
      subscribe: jest.fn(async () => subscription),
    });
    const terminal = snapshot(3, "succeeded");
    const newlyActive = snapshot(1);
    newlyActive.build_id = "build-2";
    const get = jest.fn(async () => terminal);
    const getActive = jest
      .fn()
      .mockResolvedValueOnce([snapshot(1)])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([newlyActive]);
    const getRecent = jest
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValue([terminal]);
    const watcher = new DocumentBuildWatcher({
      getApi: () =>
        ({
          start: jest.fn(),
          get,
          getActive,
          getRecent,
          cancel: jest.fn(),
        }) as any,
      getClient: async () => client as any,
      path: "docs/report.qmd",
      project_id: "project-1",
    });
    const snapshots: DocumentBuildSnapshot[] = [];
    watcher.on("snapshot", (value) => snapshots.push(value));

    await tick();
    await tick();
    expect(client.subscribe).toHaveBeenCalledTimes(1);
    expect(getActive).toHaveBeenCalledWith({ path: "docs/report.qmd" });
    expect(snapshots.map(({ seq }) => seq)).toEqual([1]);

    client.emit("connected");
    await tick();
    await tick();
    expect(get).toHaveBeenCalledWith("build-1");
    expect(snapshots.map(({ seq }) => seq)).toEqual([1, 3]);

    // The terminal repair removes the build ID, so later reconnects do not
    // repeatedly fetch it. getActive can still discover a newly active build.
    client.emit("connected");
    await tick();
    await tick();
    expect(get).toHaveBeenCalledTimes(1);
    expect(snapshots.map(({ build_id, seq }) => [build_id, seq])).toEqual([
      ["build-1", 1],
      ["build-1", 3],
      ["build-2", 1],
    ]);

    watcher.close();
    expect(subscription.close).toHaveBeenCalledTimes(1);
  });

  it("uses get to replace a sequence gap with an authoritative snapshot", async () => {
    const subscription = subscriptionWith([
      { snapshot: snapshot(1) },
      { snapshot: snapshot(3) },
    ]);
    const client = Object.assign(new EventEmitter(), {
      subscribe: jest.fn(async () => subscription),
    });
    const get = jest.fn(async () => snapshot(4, "succeeded"));
    const watcher = new DocumentBuildWatcher({
      getApi: () =>
        ({
          start: jest.fn(),
          get,
          getActive: jest.fn(async () => []),
          getRecent: jest.fn(async () => []),
          cancel: jest.fn(),
        }) as any,
      getClient: async () => client as any,
      path: "docs/report.qmd",
      project_id: "project-1",
    });
    const snapshots: DocumentBuildSnapshot[] = [];
    watcher.on("snapshot", (value) => snapshots.push(value));

    await tick();
    await tick();
    expect(get).toHaveBeenCalledWith("build-1");
    expect(snapshots.map(({ seq }) => seq)).toEqual([1, 4]);
    watcher.close();
  });

  it("repairs a missed terminal event while a build is active", async () => {
    const subscription = subscriptionWith([{ snapshot: snapshot(1) }]);
    const client = Object.assign(new EventEmitter(), {
      subscribe: jest.fn(async () => subscription),
    });
    const get = jest.fn(async () => snapshot(2, "succeeded"));
    const watcher = new DocumentBuildWatcher({
      getApi: () =>
        ({
          start: jest.fn(),
          get,
          getActive: jest.fn(async () => []),
          getRecent: jest.fn(async () => []),
          cancel: jest.fn(),
        }) as any,
      getClient: async () => client as any,
      path: "docs/report.qmd",
      poll_ms: 5,
      project_id: "project-1",
    });
    const snapshots: DocumentBuildSnapshot[] = [];
    watcher.on("snapshot", (value) => snapshots.push(value));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(get).toHaveBeenCalledWith("build-1");
    expect(snapshots.map(({ seq }) => seq)).toEqual([1, 2]);
    watcher.close();
  });

  it("ignores snapshots for another logical path", async () => {
    const other = snapshot(1);
    other.identity = {
      kind: "r-markdown",
      logical_path: "/home/user/docs/report.Rmd",
      working_path: "/home/user/docs/report.Rmd",
      resource_key: "/home/user/docs/report.document-output",
    };
    // Same-stem R Markdown and Quarto files serialize on this resource, but
    // their editors must not project each other's build events.
    expect(other.identity.resource_key).toBe(
      snapshot(1).identity.resource_key.replace(".qmd", ".document-output"),
    );
    const subscription = subscriptionWith([other]);
    const client = Object.assign(new EventEmitter(), {
      subscribe: jest.fn(async () => subscription),
    });
    const watcher = new DocumentBuildWatcher({
      getApi: () =>
        ({
          start: jest.fn(),
          get: jest.fn(),
          getActive: jest.fn(async () => []),
          getRecent: jest.fn(async () => []),
          cancel: jest.fn(),
        }) as any,
      getClient: async () => client as any,
      path: "docs/report.qmd",
      project_id: "project-1",
    });
    const onSnapshot = jest.fn();
    watcher.on("snapshot", onSnapshot);

    await tick();
    await tick();
    expect(onSnapshot).not.toHaveBeenCalled();
    watcher.close();
  });

  it("hydrates a build that completed entirely while disconnected", async () => {
    const subscription = subscriptionWith([]);
    const client = Object.assign(new EventEmitter(), {
      subscribe: jest.fn(async () => subscription),
    });
    const terminal = snapshot(4, "succeeded");
    const getRecent = jest.fn(async () => [terminal]);
    const watcher = new DocumentBuildWatcher({
      getApi: () =>
        ({
          start: jest.fn(),
          get: jest.fn(),
          getActive: jest.fn(async () => []),
          getRecent,
          cancel: jest.fn(),
        }) as any,
      getClient: async () => client as any,
      path: "docs/report.qmd",
      project_id: "project-1",
    });
    const snapshots: DocumentBuildSnapshot[] = [];
    watcher.on("snapshot", (value) => snapshots.push(value));

    await tick();
    await tick();
    expect(getRecent).toHaveBeenCalledWith({
      path: "docs/report.qmd",
      limit: 100,
    });
    expect(snapshots).toEqual([terminal]);
    watcher.close();
  });

  it("keeps another client build active when an older build completes", async () => {
    const subscription = subscriptionWith([]);
    const client = Object.assign(new EventEmitter(), {
      subscribe: jest.fn(async () => subscription),
    });
    const watcher = new DocumentBuildWatcher({
      getApi: () =>
        ({
          start: jest.fn(),
          get: jest.fn(),
          getActive: jest.fn(async () => []),
          getRecent: jest.fn(async () => []),
          cancel: jest.fn(),
        }) as any,
      getClient: async () => client as any,
      path: "docs/report.qmd",
      project_id: "project-1",
    });
    await tick();
    await tick();

    const first = snapshot(1);
    const second = snapshot(1);
    second.build_id = "build-2";
    second.submitted_at = 20;
    watcher.track(first);
    watcher.track(second);
    watcher.track({ ...first, state: "succeeded", seq: 2 });

    expect(watcher.hasActiveBuilds()).toBe(true);
    expect(watcher.latestActiveBuildId()).toBe("build-2");
    watcher.close();
  });

  it("prefers a running build over a newer queued build", async () => {
    const subscription = subscriptionWith([]);
    const client = Object.assign(new EventEmitter(), {
      subscribe: jest.fn(async () => subscription),
    });
    const watcher = new DocumentBuildWatcher({
      getApi: () =>
        ({
          start: jest.fn(),
          get: jest.fn(),
          getActive: jest.fn(async () => []),
          getRecent: jest.fn(async () => []),
          cancel: jest.fn(),
        }) as any,
      getClient: async () => client as any,
      path: "docs/report.qmd",
      project_id: "project-1",
    });
    await tick();
    await tick();

    const running = snapshot(2, "running");
    const queued = snapshot(1, "queued");
    queued.build_id = "build-queued";
    queued.submitted_at = 20;
    watcher.track(running);
    watcher.track(queued);

    expect(watcher.latestActiveBuildId()).toBe("build-1");
    watcher.close();
  });

  it("drops an active build that disappeared after a daemon restart", async () => {
    const subscription = subscriptionWith([]);
    const client = Object.assign(new EventEmitter(), {
      subscribe: jest.fn(async () => subscription),
    });
    const get = jest.fn(async () => {
      throw new Error("document build 'build-1' does not exist");
    });
    const watcher = new DocumentBuildWatcher({
      getApi: () =>
        ({
          start: jest.fn(),
          get,
          getActive: jest.fn(async () => []),
          getRecent: jest.fn(async () => []),
          cancel: jest.fn(),
        }) as any,
      getClient: async () => client as any,
      path: "docs/report.qmd",
      project_id: "project-1",
    });
    await tick();
    await tick();
    watcher.track(snapshot(1));
    expect(watcher.hasActiveBuilds()).toBe(true);

    client.emit("connected");
    await tick();
    await tick();
    expect(get).toHaveBeenCalledWith("build-1");
    expect(watcher.hasActiveBuilds()).toBe(false);
    watcher.close();
  });

  it("hydrates the latest successful artifact before a newer failure", async () => {
    const subscription = subscriptionWith([]);
    const client = Object.assign(new EventEmitter(), {
      subscribe: jest.fn(async () => subscription),
    });
    const succeeded = snapshot(3, "succeeded");
    succeeded.build_id = "build-success";
    const failed = snapshot(2, "failed");
    failed.build_id = "build-failed";
    failed.submitted_at = 20;
    const watcher = new DocumentBuildWatcher({
      getApi: () =>
        ({
          start: jest.fn(),
          get: jest.fn(),
          getActive: jest.fn(async () => []),
          getRecent: jest.fn(async () => [failed, succeeded]),
          cancel: jest.fn(),
        }) as any,
      getClient: async () => client as any,
      path: "docs/report.qmd",
      project_id: "project-1",
    });
    const snapshots: DocumentBuildSnapshot[] = [];
    watcher.on("snapshot", (value) => snapshots.push(value));

    await tick();
    await tick();
    expect(snapshots.map(({ build_id }) => build_id)).toEqual([
      "build-success",
      "build-failed",
    ]);
    watcher.close();
  });

  it("filters same-resource documents before selecting recent snapshots", async () => {
    const subscription = subscriptionWith([]);
    const client = Object.assign(new EventEmitter(), {
      subscribe: jest.fn(async () => subscription),
    });
    const own = snapshot(3, "succeeded");
    const foreign = snapshot(2, "failed");
    foreign.build_id = "build-rmd";
    foreign.submitted_at = 20;
    foreign.identity = {
      kind: "r-markdown",
      logical_path: "/home/user/docs/report.Rmd",
      working_path: "/home/user/docs/report.Rmd",
      resource_key: "/home/user/docs/report.document-output",
    };
    const watcher = new DocumentBuildWatcher({
      getApi: () =>
        ({
          start: jest.fn(),
          get: jest.fn(),
          getActive: jest.fn(async () => []),
          getRecent: jest.fn(async () => [foreign, own]),
          cancel: jest.fn(),
        }) as any,
      getClient: async () => client as any,
      path: "docs/report.qmd",
      project_id: "project-1",
    });
    const snapshots: DocumentBuildSnapshot[] = [];
    watcher.on("snapshot", (value) => snapshots.push(value));

    await tick();
    await tick();
    expect(snapshots).toEqual([own]);
    watcher.close();
  });
});

describe("documentBuildSnapshotToEditorState", () => {
  it("projects logs, commands, stats, and artifacts into legacy editor state", () => {
    const value = snapshot(5, "succeeded");
    value.exit_code = 0;
    value.artifacts = [
      { path: "docs/report.html", type: "html" },
      { path: "docs/report.nb.html", type: "notebook-html" },
    ];
    value.stages = [
      {
        stage_id: "stage-1",
        name: "quarto",
        logical_path: value.identity.logical_path,
        working_path: value.identity.working_path,
        resource_key: value.identity.resource_key,
        command: "quarto",
        args: ["render", "report.qmd"],
        cwd: "/home/user/docs",
        bash: false,
        timeout_s: 60,
        required: true,
        job_key: "quarto:report.qmd",
        state: "succeeded",
        stdout: "rendered",
        stderr: "warning",
        exit_code: 0,
        stats: [{ cpu_pct: 25, mem_rss: 100 }],
      },
    ];

    const projected = documentBuildSnapshotToEditorState(value) as any;

    expect(projected).toMatchObject({
      building: false,
      build_log: "rendered",
      build_err: "warning",
      build_exit: 0,
      build_command: {
        command: "quarto",
        args: ["render", "report.qmd"],
      },
      job_info: {
        job_id: "build-1",
        status: "completed",
        stats: [{ cpu_pct: 25, mem_rss: 100 }],
      },
    });
    expect(projected.derived_file_types.toJS().sort()).toEqual([
      "html",
      "nb.html",
    ]);
  });
});
