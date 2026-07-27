/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import assert from "node:assert/strict";
import test from "node:test";

import { Command } from "commander";

import { registerTasksCommand, resolveTasksProjectIdentifier } from "./tasks";

test("tasks project selection prefers the explicit option", () => {
  assert.equal(
    resolveTasksProjectIdentifier(" explicit-project ", "environment-project"),
    "explicit-project",
  );
});

test("tasks project selection falls back to COCALC_PROJECT_ID", () => {
  assert.equal(
    resolveTasksProjectIdentifier(undefined, " environment-project "),
    "environment-project",
  );
  assert.equal(resolveTasksProjectIdentifier(" ", " "), undefined);
});

test("tasks list binds the environment project when --project is omitted", async () => {
  const originalProjectId = process.env.COCALC_PROJECT_ID;
  let binding:
    | {
        path: string;
        projectIdentifier?: string;
      }
    | undefined;
  try {
    process.env.COCALC_PROJECT_ID = "00000000-1000-4000-8000-000000000151";
    const program = new Command();
    registerTasksCommand(program, {
      withContext: async (_command, _label, fn) => await fn({}),
      tasksApi: {
        bindDocument: (_ctx, options) => {
          binding = options;
          return {
            async getSnapshot() {
              return {
                project: { project_id: options.projectIdentifier },
                path: options.path,
                revision: null,
                tasks: [],
              };
            },
          };
        },
      },
    } as any);

    await program.parseAsync([
      "node",
      "test",
      "tasks",
      "list",
      "ops/example.tasks",
    ]);

    assert.deepEqual(binding, {
      path: "ops/example.tasks",
      projectIdentifier: "00000000-1000-4000-8000-000000000151",
    });
  } finally {
    if (originalProjectId == null) {
      delete process.env.COCALC_PROJECT_ID;
    } else {
      process.env.COCALC_PROJECT_ID = originalProjectId;
    }
  }
});
