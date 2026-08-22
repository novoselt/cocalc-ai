/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { randomUUID } from "node:crypto";
import { posix } from "node:path";
import { Command } from "commander";

import type {
  BuildArtifact,
  DocumentBuildRequest,
  DocumentBuildSnapshot,
  DocumentBuildState,
} from "@cocalc/app-document-build";
import type { ProjectCommandDeps } from "../project";
import type { DocumentBuildApi } from "./document-build";
import {
  TERMINAL_DOCUMENT_BUILD_STATES,
  waitForDocumentBuild,
} from "./document-build";

type SmokeFixture = {
  name: string;
  entry: string;
  files: Record<string, string>;
  expected_state: DocumentBuildState;
  marker?: string;
  artifact_type?: BuildArtifact["type"];
  build_timeout_ms?: number;
  output_directory?: string;
  expected_stage_tokens?: string[];
};

const LATEX_PREFIX = String.raw`\documentclass{article}
\begin{document}
`;
const LATEX_SUFFIX = String.raw`
\end{document}
`;

export const DOCUMENT_BUILD_SMOKE_FIXTURES: readonly SmokeFixture[] = [
  {
    name: "latex-bibliography",
    entry: "latex-bibliography/main.tex",
    marker: "Document Build Smoke Marker",
    artifact_type: "pdf",
    expected_state: "succeeded",
    files: {
      "latex-bibliography/main.tex": String.raw`\documentclass{article}
\begin{document}
LATEX-271828 cites \cite{smoke}. See Section~\ref{sec:smoke}.
\section{Smoke}\label{sec:smoke}
\bibliographystyle{plain}
\bibliography{refs}
\end{document}
`,
      "latex-bibliography/refs.bib": String.raw`@book{smoke,
  author = {Ada Lovelace},
  title = {Document Build Smoke Marker},
  year = {1843}
}
`,
    },
  },
  {
    name: "latex-engine-output-directory",
    entry: "latex-engine-output-directory/main.tex",
    marker: "LATEX-ENGINE-314159",
    artifact_type: "pdf",
    output_directory: "latex-engine-output-directory/build",
    expected_stage_tokens: ["-lualatex", "-output-directory="],
    expected_state: "succeeded",
    files: {
      "latex-engine-output-directory/main.tex": String.raw`% !TeX program = lualatex
\documentclass{article}
\begin{document}
LATEX-ENGINE-314159
\end{document}
`,
    },
  },
  {
    name: "knitr-rnw",
    entry: "knitr-rnw/main.Rnw",
    marker: "KNITR-RNW-42",
    artifact_type: "pdf",
    expected_state: "succeeded",
    files: {
      "knitr-rnw/main.Rnw": String.raw`\documentclass{article}
\begin{document}
KNITR-RNW-\Sexpr{6*7}
\end{document}
`,
    },
  },
  {
    name: "knitr-rtex",
    entry: "knitr-rtex/main.Rtex",
    marker: "KNITR-RTEX-42",
    artifact_type: "pdf",
    expected_state: "succeeded",
    files: {
      "knitr-rtex/main.Rtex": String.raw`\documentclass{article}
\begin{document}
KNITR-RTEX-\Sexpr{7*6}
\end{document}
`,
    },
  },
  {
    name: "sagetex",
    entry: "sagetex/main.tex",
    marker: "SAGETEX-720",
    artifact_type: "pdf",
    expected_state: "succeeded",
    files: {
      "sagetex/main.tex": String.raw`\documentclass{article}
\usepackage{sagetex}
\begin{document}
SAGETEX-\sage{factorial(6)}
\end{document}
`,
    },
  },
  {
    name: "pythontex",
    entry: "pythontex/main.tex",
    marker: "PYTHONTEX-42",
    artifact_type: "pdf",
    expected_state: "succeeded",
    files: {
      "pythontex/main.tex": String.raw`\documentclass{article}
\usepackage{pythontex}
\begin{document}
PYTHONTEX-\py{6*7}
\end{document}
`,
    },
  },
  {
    name: "sagetex-pythontex",
    entry: "sagetex-pythontex/main.tex",
    marker: "BOTH-720-42",
    artifact_type: "pdf",
    expected_state: "succeeded",
    files: {
      "sagetex-pythontex/main.tex": String.raw`\documentclass{article}
\usepackage{sagetex}
\usepackage{pythontex}
\begin{document}
BOTH-\sage{factorial(6)}-\py{6*7}
\end{document}
`,
    },
  },
  {
    name: "rmarkdown-html",
    entry: "rmarkdown-html/main.Rmd",
    marker: "RMD-HTML-42",
    artifact_type: "html",
    expected_state: "succeeded",
    files: {
      "rmarkdown-html/main.Rmd": `---\ntitle: Smoke\noutput: html_document\n---\n\nRMD-HTML-\`r 6*7\`\n`,
    },
  },
  {
    name: "rmarkdown-pdf",
    entry: "rmarkdown-pdf/main.Rmd",
    marker: "RMD-PDF-42",
    artifact_type: "pdf",
    expected_state: "succeeded",
    files: {
      "rmarkdown-pdf/main.Rmd": `---\ntitle: Smoke\noutput: pdf_document\n---\n\nRMD-PDF-\`r 6*7\`\n`,
    },
  },
  {
    name: "quarto-html",
    entry: "quarto-html/main.qmd",
    marker: "QUARTO-HTML-42",
    artifact_type: "html",
    expected_state: "succeeded",
    files: {
      "quarto-html/main.qmd": [
        "---",
        "title: Smoke",
        "format: html",
        "jupyter: python3",
        "---",
        "",
        "QUARTO-HTML-`{python} 6 * 7`",
        "",
      ].join("\n"),
    },
  },
  {
    name: "quarto-pdf",
    entry: "quarto-pdf/main.qmd",
    marker: "QUARTO-PDF-42",
    artifact_type: "pdf",
    expected_state: "succeeded",
    files: {
      "quarto-pdf/main.qmd": [
        "---",
        "title: Smoke",
        "format: pdf",
        "jupyter: python3",
        "---",
        "",
        "QUARTO-PDF-`{python} 6 * 7`",
        "",
      ].join("\n"),
    },
  },
  {
    name: "latex-failure",
    entry: "latex-failure/main.tex",
    expected_state: "failed",
    files: {
      "latex-failure/main.tex": `${LATEX_PREFIX}\\definitelyUndefinedCommand${LATEX_SUFFIX}`,
    },
  },
  {
    name: "rmarkdown-failure",
    entry: "rmarkdown-failure/main.Rmd",
    expected_state: "failed",
    files: {
      "rmarkdown-failure/main.Rmd": `---\noutput: html_document\n---\n\n\`\`\`{r}\nstop("RMD-SMOKE-FAILURE")\n\`\`\`\n`,
    },
  },
  {
    name: "quarto-failure",
    entry: "quarto-failure/main.qmd",
    expected_state: "failed",
    files: {
      "quarto-failure/main.qmd": `---\nformat: html\n---\n\n\`\`\`{python}\nraise RuntimeError("QUARTO-SMOKE-FAILURE")\n\`\`\`\n`,
    },
  },
  {
    name: "latex-timeout",
    entry: "latex-timeout/main.tex",
    expected_state: "timed_out",
    build_timeout_ms: 2_000,
    files: {
      "latex-timeout/main.tex": String.raw`\documentclass{article}
\begin{document}
\newcount\forever
\loop\advance\forever by 1\relax\iftrue\repeat
\end{document}
`,
    },
  },
] as const;

type SmokeSystemApi = {
  exec: (opts: Record<string, unknown>) => Promise<{
    stdout?: string;
    stderr?: string;
    exit_code: number;
  }>;
  writeTextFileToProject: (opts: {
    path: string;
    content: string;
  }) => Promise<void>;
  readTextFileFromProject: (opts: { path: string }) => Promise<string>;
};

function artifactOfType(
  snapshot: DocumentBuildSnapshot,
  type: BuildArtifact["type"],
): BuildArtifact | undefined {
  return snapshot.artifacts.find((artifact) => artifact.type === type);
}

async function artifactText(
  artifact: BuildArtifact,
  system: SmokeSystemApi,
): Promise<string> {
  if (artifact.type === "pdf") {
    const result = await system.exec({
      command: "pdftotext",
      args: [artifact.path, "-"],
      bash: false,
      timeout: 60,
      err_on_exit: false,
    });
    if (result.exit_code !== 0) {
      throw new Error(
        `pdftotext failed for ${artifact.path}: ${result.stderr ?? "unknown error"}`,
      );
    }
    return result.stdout ?? "";
  }
  return await system.readTextFileFromProject({ path: artifact.path });
}

function normalizedMarkerText(value: string): string {
  return value
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/\s+/g, "")
    .toUpperCase();
}

function snapshotFailureDetail(snapshot: DocumentBuildSnapshot): string {
  const diagnostic = snapshot.diagnostics.find(
    ({ level }) => level === "error",
  );
  const failedStage = [...snapshot.stages]
    .reverse()
    .find(({ state }) => state === "failed" || state === "timed_out");
  return (
    snapshot.error ??
    diagnostic?.message ??
    failedStage?.stderr?.trim() ??
    failedStage?.stdout?.trim() ??
    "no error detail returned"
  );
}

async function submitAndWait({
  api,
  request,
  timeoutMs,
  pollMs,
}: {
  api: DocumentBuildApi;
  request: DocumentBuildRequest;
  timeoutMs: number;
  pollMs: number;
}): Promise<DocumentBuildSnapshot> {
  const initial = await api.start(request);
  const waited = await waitForDocumentBuild({
    api,
    initial,
    timeoutMs,
    pollMs,
  });
  if (waited.wait_timed_out) {
    await api.cancel(initial.build_id).catch(() => undefined);
    throw new Error(
      `local wait timed out for smoke build ${initial.build_id}; cancellation requested`,
    );
  }
  return waited.snapshot;
}

export async function runDocumentBuildSmoke({
  projectId,
  api,
  system,
  timeoutMs,
  pollMs,
  keep,
  onProgress,
  scratch = `/home/user/.cocalc-document-build-smoke-${Date.now()}-${randomUUID().slice(0, 8)}`,
}: {
  projectId: string;
  api: DocumentBuildApi;
  system: SmokeSystemApi;
  timeoutMs: number;
  pollMs: number;
  keep: boolean;
  onProgress?: (message: string) => void;
  scratch?: string;
}) {
  const startedAt = Date.now();
  const results: Array<{
    name: string;
    build_id?: string;
    state: DocumentBuildState | "harness_failed";
    artifact?: string;
    marker?: string;
    error?: string;
  }> = [];
  let failed = false;

  const mkdir = await system.exec({
    command: "mkdir",
    args: ["-p", scratch],
    bash: false,
    timeout: 30,
    err_on_exit: false,
  });
  if (mkdir.exit_code !== 0) {
    throw new Error(`failed to create ${scratch}: ${mkdir.stderr ?? ""}`);
  }

  for (const fixture of DOCUMENT_BUILD_SMOKE_FIXTURES) {
    onProgress?.(`${fixture.name}: preparing`);
    try {
      for (const [relativePath, content] of Object.entries(fixture.files)) {
        const target = posix.join(scratch, relativePath);
        const parent = posix.dirname(target);
        const parentResult = await system.exec({
          command: "mkdir",
          args: ["-p", parent],
          bash: false,
          timeout: 30,
          err_on_exit: false,
        });
        if (parentResult.exit_code !== 0) {
          throw new Error(`failed to create fixture directory ${parent}`);
        }
        await system.writeTextFileToProject({ path: target, content });
      }

      const path = posix.join(scratch, fixture.entry);
      const outputDirectory = fixture.output_directory
        ? posix.join(scratch, fixture.output_directory)
        : undefined;
      if (outputDirectory) {
        const outputDirectoryResult = await system.exec({
          command: "mkdir",
          args: ["-p", outputDirectory],
          bash: false,
          timeout: 30,
          err_on_exit: false,
        });
        if (outputDirectoryResult.exit_code !== 0) {
          throw new Error(
            `failed to create output directory ${outputDirectory}`,
          );
        }
      }
      const request: DocumentBuildRequest = {
        path,
        force: true,
        request_id: `smoke-${fixture.name}-${randomUUID()}`,
        generation: `smoke-${fixture.name}`,
        ...(fixture.build_timeout_ms == null
          ? undefined
          : { build_timeout_ms: fixture.build_timeout_ms }),
        ...(outputDirectory == null
          ? undefined
          : { output_directory: outputDirectory }),
      };

      let snapshot: DocumentBuildSnapshot;
      onProgress?.(`${fixture.name}: building`);
      if (fixture === DOCUMENT_BUILD_SMOKE_FIXTURES[0]) {
        const detached = await api.start(request);
        const duplicate = await api.start(request);
        if (detached.build_id !== duplicate.build_id) {
          throw new Error(
            `same-generation submissions returned different build IDs: ${detached.build_id} and ${duplicate.build_id}`,
          );
        }
        const lookedUp = await api.get(detached.build_id);
        if (lookedUp.build_id !== detached.build_id) {
          throw new Error(
            "detached build status lookup returned the wrong build",
          );
        }
        const active = await api.getActive({ path });
        if (
          !TERMINAL_DOCUMENT_BUILD_STATES.has(lookedUp.state) &&
          !active.some((item) => item.build_id === detached.build_id)
        ) {
          throw new Error("detached build was absent from getActive");
        }
        const waited = await waitForDocumentBuild({
          api,
          initial: lookedUp,
          timeoutMs,
          pollMs,
        });
        if (waited.wait_timed_out) {
          await api.cancel(detached.build_id).catch(() => undefined);
          throw new Error(`local wait timed out for ${detached.build_id}`);
        }
        snapshot = waited.snapshot;
      } else {
        snapshot = await submitAndWait({
          api,
          request,
          timeoutMs,
          pollMs,
        });
      }

      if (snapshot.state !== fixture.expected_state) {
        throw new Error(
          `expected state ${fixture.expected_state}, got ${snapshot.state}: ${snapshotFailureDetail(snapshot)}`,
        );
      }
      if (
        snapshot.state === "failed" &&
        snapshot.diagnostics.length === 0 &&
        !snapshot.error
      ) {
        throw new Error("failed build did not return a useful diagnostic");
      }
      if (fixture.expected_stage_tokens) {
        const commands = snapshot.stages
          .map((stage) => [stage.command, ...(stage.args ?? [])].join(" "))
          .join("\n");
        for (const token of fixture.expected_stage_tokens) {
          if (!commands.includes(token)) {
            throw new Error(
              `build stages do not contain expected token ${token}`,
            );
          }
        }
      }

      let artifact: BuildArtifact | undefined;
      if (fixture.marker && fixture.artifact_type) {
        onProgress?.(`${fixture.name}: verifying artifact`);
        artifact = artifactOfType(snapshot, fixture.artifact_type);
        if (!artifact) {
          throw new Error(
            `missing ${fixture.artifact_type} artifact for semantic marker`,
          );
        }
        const rendered = await artifactText(artifact, system);
        if (
          !normalizedMarkerText(rendered).includes(
            normalizedMarkerText(fixture.marker),
          )
        ) {
          throw new Error(
            `rendered ${artifact.type} does not contain ${fixture.marker}`,
          );
        }
      }

      results.push({
        name: fixture.name,
        build_id: snapshot.build_id,
        state: snapshot.state,
        artifact: artifact?.path,
        marker: fixture.marker,
      });
      onProgress?.(`${fixture.name}: passed`);
    } catch (error) {
      failed = true;
      onProgress?.(`${fixture.name}: failed`);
      results.push({
        name: fixture.name,
        state: "harness_failed",
        error: error instanceof Error ? error.message : `${error}`,
      });
    }
  }

  const rnw = results.find((result) => result.name === "knitr-rnw");
  if (rnw?.build_id) {
    try {
      const rnwSnapshot = await api.get(rnw.build_id);
      const generatedTex = posix.join(
        posix.dirname(posix.join(scratch, "knitr-rnw/main.Rnw")),
        "main.tex",
      );
      const texSnapshot = await submitAndWait({
        api,
        request: {
          path: generatedTex,
          force: true,
          request_id: `smoke-generated-tex-${randomUUID()}`,
        },
        timeoutMs,
        pollMs,
      });
      if (
        rnwSnapshot.identity.resource_key !== texSnapshot.identity.resource_key
      ) {
        failed = true;
        results.push({
          name: "knitr-resource-identity",
          state: "harness_failed",
          error: `${rnwSnapshot.identity.resource_key} != ${texSnapshot.identity.resource_key}`,
        });
      } else {
        results.push({
          name: "knitr-resource-identity",
          build_id: texSnapshot.build_id,
          state: texSnapshot.state,
        });
      }
    } catch (error) {
      failed = true;
      results.push({
        name: "knitr-resource-identity",
        state: "harness_failed",
        error: error instanceof Error ? error.message : `${error}`,
      });
    }
  }

  let kept = keep || failed;
  if (!kept) {
    const cleanup = await system.exec({
      command: "rm",
      args: ["-rf", "--", scratch],
      bash: false,
      timeout: 60,
      err_on_exit: false,
    });
    if (cleanup.exit_code !== 0) {
      kept = true;
      failed = true;
      results.push({
        name: "cleanup",
        state: "harness_failed",
        error: cleanup.stderr ?? "cleanup failed",
      });
    }
  }

  return {
    project_id: projectId,
    ok: !failed,
    scratch,
    kept,
    elapsed_ms: Date.now() - startedAt,
    counts: {
      total: results.length,
      passed: results.filter((result) => result.state !== "harness_failed")
        .length,
      failed: results.filter((result) => result.state === "harness_failed")
        .length,
    },
    results,
  };
}

export function registerProjectBuildSmokeCommand(
  project: Command,
  deps: ProjectCommandDeps,
): void {
  const { withContext, resolveProjectProjectApi } = deps;

  project
    .command("build-smoke")
    .description(
      "run the headless document-build pipeline fixture corpus in a project",
    )
    .option("-w, --project <project>", "project id or name")
    .option("--keep", "keep the scratch fixture directory after success")
    .action(
      async (opts: { project?: string; keep?: boolean }, command: Command) => {
        await withContext(command, "project build-smoke", async (ctx) => {
          const { project: resolvedProject, api: projectApi } =
            await resolveProjectProjectApi(ctx, opts.project);
          const capabilities = await projectApi.documentBuild.capabilities();
          const required = [".tex", ".rnw", ".rtex", ".rmd", ".qmd"];
          const supported = capabilities.extensions.map((extension) => {
            const normalized = extension.toLowerCase();
            return normalized.startsWith(".") ? normalized : `.${normalized}`;
          });
          const missing = required.filter(
            (extension) => !supported.includes(extension),
          );
          if (missing.length > 0) {
            throw new Error(
              `project document-build service lacks required smoke-test extensions: ${missing.join(", ")}`,
            );
          }
          const result = await runDocumentBuildSmoke({
            projectId: resolvedProject.project_id,
            api: projectApi.documentBuild as DocumentBuildApi,
            system: projectApi.system as SmokeSystemApi,
            timeoutMs: ctx.timeoutMs,
            pollMs: ctx.pollMs,
            keep: !!opts.keep,
            onProgress:
              ctx.globals.json || ctx.globals.output === "json"
                ? undefined
                : (message) => process.stderr.write(`${message}\n`),
          });
          if (!result.ok) process.exitCode = 1;
          return result;
        });
      },
    );
}
