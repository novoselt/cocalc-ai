import assert from "node:assert/strict";
import test from "node:test";

import { Command } from "commander";

import type { CourseSyncDB } from "../../core/project-course";
import { registerProjectCourseCommands } from "./course";

test("course RootFS apply acquires account authority before mutation", async () => {
  const calls: string[] = [];
  const rows: Record<string, any>[] = [{ table: "settings", title: "Math" }];
  const syncdb: CourseSyncDB = {
    wait_until_ready: async () => undefined,
    get: () => ({ toJS: () => rows.map((row) => ({ ...row })) }),
    get_one: (where) => {
      const row = rows.find((candidate) =>
        Object.entries(where).every(([key, value]) => candidate[key] === value),
      );
      return row ? { toJS: () => ({ ...row }) } : undefined;
    },
    set: (patch) => {
      calls.push("syncdb-set");
      Object.assign(rows[0], patch);
    },
    commit: () => true,
    save: async () => undefined,
    save_to_disk: async () => undefined,
    close: async () => undefined,
  };
  const deps = {
    withContext: async (_command, _label, fn) => {
      await fn({
        accountId: "account-1",
        timeoutMs: 10_000,
        pollMs: 1,
        hub: {
          system: {
            getAccountBay: async () => {
              calls.push("get-account-bay");
              return { home_bay_id: "bay-0" };
            },
            setProjectRootfsImage: async () => [],
          },
          projects: {
            getProjectEnv: async () => undefined,
            reconfigureCourseProjects: async () => ({
              op_id: "op-1",
              scope_type: "project",
              scope_id: "course-project",
              service: "course-reconfigure",
              stream_name: "stream-1",
              requested_snapshot_hash: "snapshot-1",
              operation_snapshot_hash: "snapshot-1",
            }),
            getCourseReconfigureOperation: async () => ({
              op_id: "op-1",
              status: "succeeded",
              result: { items: [] },
              error: null,
            }),
            getProjectState: async () => ({ state: "stopped" }),
            restart: async () => ({ op_id: "restart-1" }),
          },
        },
      });
    },
    resolveProjectConatClient: async () => {
      calls.push("resolve-project-client");
      return {
        project: { project_id: "course-project" },
        client: { sync: { db: () => syncdb } },
      };
    },
  };
  const program = new Command();
  program.name("cocalc");
  const project = program.command("project");
  registerProjectCourseCommands(project, deps as any);

  await program.parseAsync([
    "node",
    "cocalc",
    "project",
    "course",
    "config",
    "set-rootfs",
    "math.course",
    "rootfs/image",
    "--apply",
  ]);

  assert.equal(calls[0], "get-account-bay");
  assert.ok(calls.indexOf("get-account-bay") < calls.indexOf("syncdb-set"));
});
