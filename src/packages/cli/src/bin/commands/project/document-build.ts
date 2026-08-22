/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { extname } from "node:path";
import { Command } from "commander";

import type {
  DocumentBuildCapabilities,
  DocumentBuildRequest,
  DocumentBuildSnapshot,
  DocumentBuildState,
} from "@cocalc/app-document-build";
import type { ProjectCommandDeps } from "../project";

type DocumentBuildApi = {
  capabilities: () => Promise<DocumentBuildCapabilities>;
  start: (request: DocumentBuildRequest) => Promise<DocumentBuildSnapshot>;
  get: (buildId: string) => Promise<DocumentBuildSnapshot>;
  getActive: (query: { path?: string }) => Promise<DocumentBuildSnapshot[]>;
  cancel: (buildId: string) => Promise<DocumentBuildSnapshot>;
};

type BuildCommandContext = {
  timeoutMs: number;
  pollMs: number;
  globals: { json?: boolean; output?: string; quiet?: boolean };
};

export const TERMINAL_DOCUMENT_BUILD_STATES = new Set<DocumentBuildState>([
  "succeeded",
  "failed",
  "canceled",
  "timed_out",
]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isStructuredOutput(ctx: BuildCommandContext): boolean {
  return ctx.globals.json || ctx.globals.output === "json";
}

export function documentBuildExitCode(snapshot: DocumentBuildSnapshot): number {
  switch (snapshot.state) {
    case "succeeded":
      return 0;
    case "timed_out":
      return 124;
    case "canceled":
      return 130;
    case "failed": {
      const code = Number(snapshot.exit_code);
      return Number.isInteger(code) && code > 0 && code <= 255 ? code : 1;
    }
    default:
      return 0;
  }
}

export function parsePositiveBuildDuration(
  value: string | undefined,
  durationToMs: (value: string | undefined, fallbackMs: number) => number,
): number | undefined {
  if (value == null) return undefined;
  const milliseconds = durationToMs(value, 0);
  if (!Number.isFinite(milliseconds) || milliseconds <= 0) {
    throw new Error("--build-timeout must be a positive duration");
  }
  return milliseconds;
}

export function assertBuildPathSupported(
  path: string,
  capabilities: DocumentBuildCapabilities,
): void {
  const extension = extname(path).toLowerCase();
  const supported = capabilities.extensions.map((value) => {
    const normalized = value.toLowerCase();
    return normalized.startsWith(".") ? normalized : `.${normalized}`;
  });
  if (!extension || !supported.includes(extension)) {
    throw new Error(
      `unsupported document type '${extension || "(none)"}'; supported extensions: ${capabilities.extensions.join(", ")}`,
    );
  }
}

export async function waitForDocumentBuild({
  api,
  initial,
  timeoutMs,
  pollMs,
  onProgress,
}: {
  api: DocumentBuildApi;
  initial: DocumentBuildSnapshot;
  timeoutMs: number;
  pollMs: number;
  onProgress?: (snapshot: DocumentBuildSnapshot) => void;
}): Promise<{
  snapshot: DocumentBuildSnapshot;
  wait_timed_out: boolean;
}> {
  let snapshot = initial;
  let lastSeq = -1;
  const started = Date.now();
  while (true) {
    if (snapshot.seq !== lastSeq) {
      lastSeq = snapshot.seq;
      onProgress?.(snapshot);
    }
    if (TERMINAL_DOCUMENT_BUILD_STATES.has(snapshot.state)) {
      return { snapshot, wait_timed_out: false };
    }
    if (Date.now() - started >= timeoutMs) {
      return { snapshot, wait_timed_out: true };
    }
    await sleep(Math.max(50, Math.min(pollMs, timeoutMs)));
    snapshot = await api.get(snapshot.build_id);
  }
}

export function documentBuildResult({
  projectId,
  snapshot,
  detached,
  waitTimedOut = false,
}: {
  projectId: string;
  snapshot: DocumentBuildSnapshot;
  detached: boolean;
  waitTimedOut?: boolean;
}) {
  const diagnosticSummary = snapshot.diagnostics.reduce(
    (summary, diagnostic) => {
      summary[diagnostic.level] += 1;
      return summary;
    },
    { error: 0, warning: 0, typesetting: 0 },
  );
  return {
    project_id: projectId,
    detached,
    wait_timed_out: waitTimedOut,
    build_id: snapshot.build_id,
    state: snapshot.state,
    identity: snapshot.identity,
    exit_code: snapshot.exit_code,
    diagnostics_summary: diagnosticSummary,
    diagnostics: snapshot.diagnostics,
    artifacts: snapshot.artifacts,
    stages: snapshot.stages,
    submitted_at: snapshot.submitted_at,
    started_at: snapshot.started_at,
    ended_at: snapshot.ended_at,
    error: snapshot.error,
  };
}

export function registerProjectDocumentBuildCommands(
  project: Command,
  deps: ProjectCommandDeps,
): void {
  const { withContext, resolveProjectProjectApi, durationToMs } = deps;

  project
    .command("build <path>")
    .description(
      "build a saved LaTeX, Knitr, R Markdown, or Quarto document in the project",
    )
    .option("-w, --project <project>", "project id or name")
    .option("--force", "force all applicable pipeline stages")
    .option("--detach", "return immediately after submitting the build")
    .option(
      "--build-timeout <duration>",
      "project-side whole-build deadline (for example 5m or 900s)",
    )
    .action(
      async (
        path: string,
        opts: {
          project?: string;
          force?: boolean;
          detach?: boolean;
          buildTimeout?: string;
        },
        command: Command,
      ) => {
        await withContext(command, "project build", async (ctx) => {
          const { project: resolvedProject, api: projectApi } =
            await resolveProjectProjectApi(ctx, opts.project);
          const api = projectApi.documentBuild as DocumentBuildApi;
          const capabilities = await api.capabilities();
          assertBuildPathSupported(path, capabilities);
          const buildTimeoutMs = parsePositiveBuildDuration(
            opts.buildTimeout,
            durationToMs,
          );
          const snapshot = await api.start({
            path,
            force: !!opts.force,
            ...(buildTimeoutMs == null
              ? undefined
              : { build_timeout_ms: buildTimeoutMs }),
          });

          if (opts.detach) {
            return documentBuildResult({
              projectId: resolvedProject.project_id,
              snapshot,
              detached: true,
            });
          }

          const humanProgress = isStructuredOutput(ctx)
            ? undefined
            : (current: DocumentBuildSnapshot) => {
                if (ctx.globals.quiet) return;
                const stage = [...current.stages]
                  .reverse()
                  .find((item) => item.state === "running");
                process.stderr.write(
                  `build ${current.build_id}: ${current.state}${stage ? ` (${stage.name})` : ""}\n`,
                );
              };
          const waited = await waitForDocumentBuild({
            api,
            initial: snapshot,
            timeoutMs: ctx.timeoutMs,
            pollMs: ctx.pollMs,
            onProgress: humanProgress,
          });
          if (waited.wait_timed_out) {
            process.exitCode = 124;
            if (!isStructuredOutput(ctx) && !ctx.globals.quiet) {
              process.stderr.write(
                `local wait timed out; build ${waited.snapshot.build_id} is still ${waited.snapshot.state} and was not canceled\n`,
              );
            }
          } else {
            process.exitCode =
              documentBuildExitCode(waited.snapshot) || undefined;
          }
          return documentBuildResult({
            projectId: resolvedProject.project_id,
            snapshot: waited.snapshot,
            detached: false,
            waitTimedOut: waited.wait_timed_out,
          });
        });
      },
    );
}

export type { DocumentBuildApi };
