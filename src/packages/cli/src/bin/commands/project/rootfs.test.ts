import assert from "node:assert/strict";
import test from "node:test";

import { Command } from "commander";

import { registerProjectRootfsCommands } from "./rootfs";

function createProgram(calls: any[], outputs: any[]): Command {
  const deps = {
    withContext: async (_command, _label, fn) => {
      const ctx = {
        hub: {
          system: {
            getProjectRootfsStates: async (opts) => {
              calls.push(["get", opts]);
              return [{ state_role: "current", runtime_image: "image:1" }];
            },
            setProjectRootfsImage: async (opts) => {
              calls.push(["set", opts]);
              return [{ state_role: "current", runtime_image: opts.image }];
            },
          },
        },
      };
      outputs.push(await fn(ctx));
    },
    resolveProjectFromArgOrContext: async (_ctx, project) => ({
      project_id: project ?? "context-project-id",
      title: "Project",
    }),
  };
  const program = new Command();
  program.name("cocalc");
  const project = program.command("project");
  registerProjectRootfsCommands(project, deps as any);
  return program;
}

test("project rootfs get returns managed RootFS state", async () => {
  const calls: any[] = [];
  const outputs: any[] = [];
  const program = createProgram(calls, outputs);

  await program.parseAsync([
    "node",
    "cocalc",
    "project",
    "rootfs",
    "get",
    "--project",
    "project-id",
  ]);

  assert.deepEqual(calls, [["get", { project_id: "project-id" }]]);
  assert.equal(outputs[0].project_id, "project-id");
  assert.equal(outputs[0].states[0].runtime_image, "image:1");
});

test("project rootfs set preserves the catalog image id", async () => {
  const calls: any[] = [];
  const outputs: any[] = [];
  const program = createProgram(calls, outputs);

  await program.parseAsync([
    "node",
    "cocalc",
    "project",
    "rootfs",
    "set",
    "cocalc.local/rootfs/digest",
    "--project",
    "project-id",
    "--image-id",
    "image-id",
  ]);

  assert.deepEqual(calls, [
    [
      "set",
      {
        project_id: "project-id",
        image: "cocalc.local/rootfs/digest",
        image_id: "image-id",
      },
    ],
  ]);
  assert.equal(outputs[0].project_id, "project-id");
});
