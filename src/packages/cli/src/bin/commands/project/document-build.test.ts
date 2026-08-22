import assert from "node:assert/strict";
import test from "node:test";

import { Command } from "commander";

import type { DocumentBuildSnapshot } from "@cocalc/app-document-build";
import {
  documentBuildExitCode,
  registerProjectDocumentBuildCommands,
} from "./document-build";

function snapshot(
  state: DocumentBuildSnapshot["state"],
  overrides: Partial<DocumentBuildSnapshot> = {},
): DocumentBuildSnapshot {
  return {
    build_id: "build-1",
    identity: {
      kind: "latex",
      logical_path: "/home/user/paper.tex",
      working_path: "/home/user/paper.tex",
      resource_key: "/home/user/paper.tex",
    },
    state,
    seq: state === "queued" ? 1 : 2,
    submitted_at: 1,
    build_timeout_ms: 900_000,
    force: false,
    stages: [],
    diagnostics: [],
    dependencies: [],
    artifacts: [],
    ...overrides,
  };
}

function createProgram({
  start,
  get,
  timeoutMs = 1_000,
}: {
  start: (request: any) => Promise<DocumentBuildSnapshot>;
  get: (buildId: string) => Promise<DocumentBuildSnapshot>;
  timeoutMs?: number;
}) {
  const outputs: any[] = [];
  const deps = {
    durationToMs: (value: string | undefined, fallback: number) => {
      if (value == null) return fallback;
      const match = value.match(/^(\d+)(ms|s|m)$/);
      if (!match) throw new Error(`invalid duration '${value}'`);
      const scale = { ms: 1, s: 1_000, m: 60_000 }[match[2]]!;
      return Number(match[1]) * scale;
    },
    withContext: async (_command, _label, fn) => {
      outputs.push(
        await fn({
          timeoutMs,
          pollMs: 1,
          globals: { json: true, output: "json" },
        }),
      );
    },
    resolveProjectProjectApi: async (_ctx, project) => ({
      project: { project_id: project ?? "project-id", title: "Project" },
      api: {
        documentBuild: {
          capabilities: async () => ({
            kinds: [{ kind: "latex", extensions: [".tex"] }],
            extensions: [".tex"],
            supports_cancel: true,
            supports_build_timeout: true,
          }),
          start,
          get,
          getActive: async () => [],
          cancel: async () => snapshot("canceled"),
        },
      },
    }),
  };
  const program = new Command();
  program.name("cocalc");
  const project = program.command("project");
  registerProjectDocumentBuildCommands(project, deps as any);
  return { program, outputs };
}

test("project build waits by default and sends force and build timeout", async () => {
  let request: any;
  const queued = snapshot("queued");
  const succeeded = snapshot("succeeded", {
    artifacts: [{ path: "/home/user/paper.pdf", type: "pdf" }],
  });
  const { program, outputs } = createProgram({
    start: async (value) => {
      request = value;
      return queued;
    },
    get: async (buildId) => {
      assert.equal(buildId, "build-1");
      return succeeded;
    },
  });
  const oldExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await program.parseAsync([
      "node",
      "cocalc",
      "project",
      "build",
      "/home/user/paper.tex",
      "--project",
      "project-id",
      "--force",
      "--build-timeout",
      "5m",
    ]);
    assert.deepEqual(request, {
      path: "/home/user/paper.tex",
      force: true,
      build_timeout_ms: 300_000,
    });
    assert.equal(outputs[0].state, "succeeded");
    assert.equal(outputs[0].detached, false);
    assert.equal(outputs[0].wait_timed_out, false);
    assert.equal(process.exitCode, undefined);
  } finally {
    process.exitCode = oldExitCode;
  }
});

test("project build --detach submits without polling", async () => {
  let getCalls = 0;
  const { program, outputs } = createProgram({
    start: async () => snapshot("queued"),
    get: async () => {
      getCalls += 1;
      return snapshot("succeeded");
    },
  });
  await program.parseAsync([
    "node",
    "cocalc",
    "project",
    "build",
    "/home/user/paper.tex",
    "--detach",
  ]);
  assert.equal(getCalls, 0);
  assert.equal(outputs[0].detached, true);
  assert.equal(outputs[0].build_id, "build-1");
});

test("a local wait timeout does not cancel the project build", async () => {
  let cancelCalls = 0;
  const outputs: any[] = [];
  const deps = {
    durationToMs: () => 1,
    withContext: async (_command, _label, fn) => {
      outputs.push(
        await fn({
          timeoutMs: 1,
          pollMs: 1,
          globals: { json: true, output: "json" },
        }),
      );
    },
    resolveProjectProjectApi: async () => ({
      project: { project_id: "project-id" },
      api: {
        documentBuild: {
          capabilities: async () => ({ extensions: [".tex"] }),
          start: async () => snapshot("queued"),
          get: async () => snapshot("running"),
          cancel: async () => {
            cancelCalls += 1;
            return snapshot("canceled");
          },
        },
      },
    }),
  };
  const program = new Command();
  program.name("cocalc");
  registerProjectDocumentBuildCommands(program.command("project"), deps as any);
  const oldExitCode = process.exitCode;
  process.exitCode = undefined;
  try {
    await program.parseAsync([
      "node",
      "cocalc",
      "project",
      "build",
      "/home/user/paper.tex",
    ]);
    assert.equal(cancelCalls, 0);
    assert.equal(outputs[0].wait_timed_out, true);
    assert.equal(outputs[0].state, "running");
    assert.equal(process.exitCode, 124);
  } finally {
    process.exitCode = oldExitCode;
  }
});

test("document build terminal states map to stable exit statuses", () => {
  assert.equal(documentBuildExitCode(snapshot("succeeded")), 0);
  assert.equal(documentBuildExitCode(snapshot("failed")), 1);
  assert.equal(
    documentBuildExitCode(snapshot("failed", { exit_code: 17 })),
    17,
  );
  assert.equal(documentBuildExitCode(snapshot("timed_out")), 124);
  assert.equal(documentBuildExitCode(snapshot("canceled")), 130);
});

test("project build rejects unsupported extensions before submission", async () => {
  let starts = 0;
  const { program } = createProgram({
    start: async () => {
      starts += 1;
      return snapshot("queued");
    },
    get: async () => snapshot("succeeded"),
  });
  await assert.rejects(
    program.parseAsync([
      "node",
      "cocalc",
      "project",
      "build",
      "/home/user/paper.md",
    ]),
    /unsupported document type/,
  );
  assert.equal(starts, 0);
});
