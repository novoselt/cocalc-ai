import assert from "node:assert/strict";
import test from "node:test";

import type {
  BuildArtifact,
  DocumentBuildRequest,
  DocumentBuildSnapshot,
} from "@cocalc/app-document-build";
import {
  DOCUMENT_BUILD_SMOKE_FIXTURES,
  runDocumentBuildSmoke,
} from "./build-smoke";

test("the smoke corpus covers every document pipeline and semantic failures", () => {
  const names = new Set(
    DOCUMENT_BUILD_SMOKE_FIXTURES.map((fixture) => fixture.name),
  );
  for (const expected of [
    "latex-bibliography",
    "latex-engine-output-directory",
    "knitr-rnw",
    "knitr-rtex",
    "sagetex",
    "pythontex",
    "sagetex-pythontex",
    "rmarkdown-html",
    "rmarkdown-pdf",
    "quarto-html",
    "quarto-pdf",
    "latex-failure",
    "rmarkdown-failure",
    "quarto-failure",
    "latex-timeout",
  ]) {
    assert(names.has(expected), `missing smoke fixture ${expected}`);
  }
});

test("runDocumentBuildSmoke verifies rendered markers and API semantics", async () => {
  const snapshots = new Map<string, DocumentBuildSnapshot>();
  const idsByGeneration = new Map<string, string>();
  const markerByArtifact = new Map<string, string>();
  const writes: string[] = [];
  let nextId = 0;

  const start = async (
    request: DocumentBuildRequest,
  ): Promise<DocumentBuildSnapshot> => {
    const generationKey = `${request.path}:${request.generation ?? request.request_id}`;
    const existing = idsByGeneration.get(generationKey);
    if (existing) return snapshots.get(existing)!;
    const fixture = [...DOCUMENT_BUILD_SMOKE_FIXTURES]
      .sort((a, b) => b.entry.length - a.entry.length)
      .find((item) => request.path.endsWith(item.entry));
    const generatedKnitrTex = request.path.endsWith("knitr-rnw/main.tex");
    const id = `build-${++nextId}`;
    const state = generatedKnitrTex
      ? "succeeded"
      : (fixture?.expected_state ?? "failed");
    const artifact: BuildArtifact | undefined = fixture?.artifact_type
      ? {
          path: request.path.replace(/\.[^.]+$/, `.${fixture.artifact_type}`),
          type: fixture.artifact_type,
        }
      : undefined;
    if (artifact && fixture?.marker) {
      markerByArtifact.set(artifact.path, fixture.marker);
    }
    const isKnitrIdentity =
      request.path.endsWith("knitr-rnw/main.Rnw") || generatedKnitrTex;
    const snapshot: DocumentBuildSnapshot = {
      build_id: id,
      request_id: request.request_id,
      generation: request.generation,
      identity: {
        kind: request.path.endsWith(".Rnw") ? "knitr" : "latex",
        logical_path: request.path,
        working_path: isKnitrIdentity
          ? request.path.replace(/\.Rnw$/, ".tex")
          : request.path,
        resource_key: isKnitrIdentity
          ? request.path.replace(/\.(Rnw|tex)$/, ".tex")
          : request.path,
      },
      state,
      seq: 2,
      submitted_at: 1,
      build_timeout_ms: request.build_timeout_ms ?? 900_000,
      force: !!request.force,
      stages: fixture?.expected_stage_tokens
        ? [
            {
              stage_id: "latex-1",
              name: "latex",
              logical_path: request.path,
              working_path: request.path,
              resource_key: request.path,
              command: "latexmk",
              args: fixture.expected_stage_tokens,
              cwd: "/home/user",
              bash: false,
              timeout_s: 60,
              required: true,
              job_key: "smoke",
              state: "succeeded",
              stdout: "",
              stderr: "",
              exit_code: 0,
            },
          ]
        : [],
      diagnostics:
        state === "failed"
          ? [
              {
                level: "error",
                source: "latex",
                message: "intentional fixture failure",
              },
            ]
          : [],
      dependencies: [],
      artifacts: artifact ? [artifact] : [],
      exit_code: state === "succeeded" ? 0 : 1,
    };
    snapshots.set(id, snapshot);
    idsByGeneration.set(generationKey, id);
    return snapshot;
  };

  const api = {
    capabilities: async () => ({
      kinds: [],
      extensions: [".tex", ".rnw", ".rtex", ".rmd", ".qmd"],
      supports_cancel: true,
      supports_build_timeout: true,
    }),
    start,
    get: async (id: string) => snapshots.get(id)!,
    getActive: async () => [],
    cancel: async (id: string) => snapshots.get(id)!,
  };
  const system = {
    exec: async (opts: any) => {
      if (opts.command === "pdftotext") {
        return {
          stdout: markerByArtifact.get(opts.args[0]) ?? "",
          stderr: "",
          exit_code: 0,
        };
      }
      return { stdout: "", stderr: "", exit_code: 0 };
    },
    writeTextFileToProject: async ({ path }: { path: string }) => {
      writes.push(path);
    },
    readTextFileFromProject: async ({ path }: { path: string }) =>
      markerByArtifact.get(path) ?? "",
  };

  const result = await runDocumentBuildSmoke({
    projectId: "project-id",
    api,
    system,
    timeoutMs: 1_000,
    pollMs: 1,
    keep: false,
    scratch: "/home/user/smoke-test",
  });

  assert.equal(result.ok, true, JSON.stringify(result.results, null, 2));
  assert.equal(result.kept, false);
  assert.equal(result.counts.failed, 0);
  assert(
    result.results.some((item) => item.name === "knitr-resource-identity"),
  );
  assert(writes.some((path) => path.endsWith("latex-bibliography/refs.bib")));
});
