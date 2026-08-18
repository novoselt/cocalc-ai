import { closeDatabase, getDatabase } from "@cocalc/lite/hub/sqlite/database";
import {
  ensureProjectsTable,
  getProject,
  getProjectsUsingRootfsImage,
  listProjectQuotaRepairBatch,
  listUnreportedProjects,
  listRuntimeArtifactReferences,
  markProjectStateReported,
  upsertProject,
} from "./projects";
import {
  acceptProjectVolumeQuotaDesired,
  getProjectVolumeQuota,
} from "./volume-quotas";

describe("project sqlite runtime ports", () => {
  const prevFilename = process.env.COCALC_LITE_SQLITE_FILENAME;
  const project_id = "1fc5e846-547c-4c78-baa3-d0528685eea0";

  beforeEach(() => {
    process.env.COCALC_LITE_SQLITE_FILENAME = ":memory:";
    closeDatabase();
  });

  afterEach(() => {
    closeDatabase();
    if (prevFilename == null) {
      delete process.env.COCALC_LITE_SQLITE_FILENAME;
    } else {
      process.env.COCALC_LITE_SQLITE_FILENAME = prevFilename;
    }
  });

  it("allows explicit clearing of stale ssh/http ports", () => {
    upsertProject({
      project_id,
      state: "running",
      http_port: 12345,
      ssh_port: 23456,
    });
    expect(getProject(project_id)?.http_port).toBe(12345);
    expect(getProject(project_id)?.ssh_port).toBe(23456);

    upsertProject({
      project_id,
      state: "opened",
      http_port: null,
      ssh_port: null,
    });
    expect(getProject(project_id)?.http_port).toBeNull();
    expect(getProject(project_id)?.ssh_port).toBeNull();
  });

  it("does not let an old state acknowledgement suppress a newer report", () => {
    upsertProject({ project_id, state: "running" });
    expect(markProjectStateReported(project_id, "running")).toBe(true);
    expect(listUnreportedProjects()).toEqual([]);

    upsertProject({ project_id, state: "opened" });
    expect(markProjectStateReported(project_id, "opened")).toBe(true);
    expect(listUnreportedProjects()).toEqual([]);

    // A delayed acknowledgement for the earlier running report may have
    // overwritten the master after opened was accepted. Requeue the current
    // state so the periodic reporter restores convergence.
    expect(markProjectStateReported(project_id, "running")).toBe(false);
    expect(listUnreportedProjects()).toEqual([
      { project_id, state: "opened", state_updated_at: expect.any(Number) },
    ]);

    expect(markProjectStateReported(project_id, "opened")).toBe(true);
    expect(listUnreportedProjects()).toEqual([]);
  });

  it("reports and clears an unexpected runtime exit reason", () => {
    upsertProject({ project_id, state: "running", state_reported: true });
    upsertProject({
      project_id,
      state: "opened",
      runtime_exit_reason: "container_missing",
    });
    expect(listUnreportedProjects()).toEqual([
      {
        project_id,
        state: "opened",
        state_updated_at: expect.any(Number),
        runtime_exit_reason: "container_missing",
      },
    ]);
    expect(markProjectStateReported(project_id, "opened")).toBe(false);
    expect(
      markProjectStateReported(project_id, "opened", "container_missing"),
    ).toBe(true);

    upsertProject({ project_id, state: "starting" });
    expect(getProject(project_id)?.runtime_exit_reason).toBeNull();
  });

  it("does not move the lifecycle timestamp during metadata refreshes", () => {
    upsertProject({
      project_id,
      state: "running",
      state_updated_at: 1_785_552_000_000,
      updated_at: 1_785_552_000_000,
    });
    upsertProject({
      project_id,
      state: "running",
      title: "metadata refresh",
      updated_at: 1_785_552_010_000,
    });

    expect(listUnreportedProjects()).toEqual([
      {
        project_id,
        state: "running",
        state_updated_at: 1_785_552_000_000,
      },
    ]);
  });

  it("stores and aggregates running project bundle/tools references", () => {
    upsertProject({
      project_id,
      state: "running",
      project_bundle_version: "bundle-v2",
      tools_version: "tools-v7",
    });
    upsertProject({
      project_id: "72d1e771-99c0-47b2-b8b0-a29d882646a8",
      state: "running",
      project_bundle_version: "bundle-v2",
      tools_version: "tools-v6",
    });
    upsertProject({
      project_id: "502bcc4e-f2b4-4450-8646-75d1c2655c01",
      state: "opened",
      project_bundle_version: "bundle-v1",
      tools_version: "tools-v5",
    });

    expect(getProject(project_id)?.project_bundle_version).toBe("bundle-v2");
    expect(getProject(project_id)?.tools_version).toBe("tools-v7");
    expect(listRuntimeArtifactReferences()).toEqual({
      project_bundle: [{ version: "bundle-v2", project_count: 2 }],
      tools: [
        { version: "tools-v7", project_count: 1 },
        { version: "tools-v6", project_count: 1 },
      ],
    });
  });

  it("uses keyed RootFS lookup and bounded quota repair batches at 10K projects", () => {
    upsertProject({
      project_id: "project-00000",
      state: "opened",
      image: "ubuntu:latest",
      disk: 1_000_000,
      scratch: 1_000_000,
    });
    const db = getDatabase();
    const insert = db.prepare(
      `INSERT INTO projects(project_id, state, image, disk, scratch)
       VALUES (?, 'opened', ?, ?, ?)`,
    );
    db.exec("BEGIN");
    try {
      for (let i = 1; i < 10_050; i += 1) {
        insert.run(
          `project-${`${i}`.padStart(5, "0")}`,
          i === 9_999 ? "docker.io/ubuntu:latest" : "docker.io/debian:latest",
          1_000_000,
          1_000_000,
        );
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    expect(getProjectsUsingRootfsImage("ubuntu:latest")).toEqual([
      expect.objectContaining({ project_id: "project-00000" }),
      expect.objectContaining({ project_id: "project-09999" }),
    ]);
    const first = listProjectQuotaRepairBatch({ limit: 32 });
    expect(first).toHaveLength(32);
    const second = listProjectQuotaRepairBatch({
      after_project_id: first.at(-1)!.project_id,
      limit: 32,
    });
    expect(second).toHaveLength(32);
    expect(second[0].project_id).toBe("project-00032");
  });

  it("persists project secret names without storing values", () => {
    upsertProject({
      project_id,
      state: "running",
      secret_names: ["API_KEY", "SSH_KEY"],
    });
    expect(getProject(project_id)?.secret_names).toEqual([
      "API_KEY",
      "SSH_KEY",
    ]);

    upsertProject({
      project_id,
      state: "opened",
    });
    expect(getProject(project_id)?.secret_names).toEqual([
      "API_KEY",
      "SSH_KEY",
    ]);

    upsertProject({
      project_id,
      state: "opened",
      secret_names: [],
    });
    expect(getProject(project_id)?.secret_names).toEqual([]);
  });

  it("returns mirrored project users for project-host auth and viewer policy checks", () => {
    const account_id = "6426eb12-2e1e-4dcb-b7e5-ed891a129f4b";
    const users = {
      [account_id]: {
        group: "viewer",
        read_policy: { rules: [{ action: "include", path: "foo/bar/**" }] },
      },
    };

    upsertProject({
      project_id,
      state: "running",
      users,
    });

    expect(getProject(project_id)?.users).toEqual(users);
  });

  it("preserves the RootFS image across unrelated metadata updates", () => {
    const image = "cocalc.local/rootfs/onboarding";
    upsertProject({
      project_id,
      state: "running",
      image,
    });

    // These are the metadata-only writes performed after a successful start.
    upsertProject({ project_id, authorized_keys: "ssh-ed25519 test" });
    upsertProject({ project_id, users: {} });

    expect(getProject(project_id)?.image).toBe(image);
    expect(
      getDatabase()
        .prepare("SELECT image FROM projects WHERE project_id=?")
        .get(project_id),
    ).toEqual({ image });
  });

  it("repairs legacy quota columns and ledgers from versioned run_quota", () => {
    const run_quota = { disk_quota: 100_000, memory_limit: 16_000 };
    ensureProjectsTable();
    getDatabase()
      .prepare(
        `INSERT INTO projects(
           project_id, state, disk, scratch, run_quota, run_quota_revision
         ) VALUES (?, 'opened', ?, ?, ?, ?)`,
      )
      .run(
        project_id,
        50_000_000_000,
        50_000_000_000,
        JSON.stringify(run_quota),
        2,
      );
    for (const volume_kind of ["home", "scratch"] as const) {
      acceptProjectVolumeQuotaDesired({
        project_id,
        volume_kind,
        desired_bytes: 50_000_000_000,
        desired_revision: 2,
      });
    }

    upsertProject({ project_id, run_quota, run_quota_revision: 2 });

    expect(getProject(project_id)).toEqual(
      expect.objectContaining({
        disk: 100_000_000_000,
        scratch: 100_000_000_000,
        run_quota_revision: 2,
      }),
    );
    for (const volume_kind of ["home", "scratch"] as const) {
      expect(getProjectVolumeQuota(project_id, volume_kind)).toEqual(
        expect.objectContaining({
          desired_bytes: 100_000_000_000,
          desired_revision: 2,
          state: "pending",
        }),
      );
    }
  });

  it("still rejects different run_quota JSON at one revision", () => {
    upsertProject({
      project_id,
      run_quota: { disk_quota: 50_000 },
      run_quota_revision: 2,
    });
    expect(() =>
      upsertProject({
        project_id,
        run_quota: { disk_quota: 100_000 },
        run_quota_revision: 2,
      }),
    ).toThrow("conflicting run_quota");
  });

  it("accepts semantically identical reordered run_quota JSON", () => {
    upsertProject({
      project_id,
      run_quota: {
        network: true,
        disk_quota: 100_000,
        scheduling: { priority: 5, io_class: "premium" },
      },
      run_quota_revision: 7,
    });

    expect(() =>
      upsertProject({
        project_id,
        run_quota: {
          scheduling: { io_class: "premium", priority: 5 },
          disk_quota: 100_000,
          network: true,
        },
        run_quota_revision: 7,
      }),
    ).not.toThrow();
    expect(getProject(project_id)?.run_quota).toEqual({
      disk_quota: 100_000,
      network: true,
      scheduling: { io_class: "premium", priority: 5 },
    });
  });
});
