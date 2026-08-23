/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  BuildDocumentIdentity,
  BuildDiagnostic,
  BuildStageEvent,
  BuildStageResult,
  BuildStageSpec,
  DocumentBuildCallbacks,
  DocumentBuildRequest,
  DocumentBuildRuntime,
  DocumentBuildSnapshot,
  DocumentBuildState,
} from "./contracts";

export const DEFAULT_BUILD_TIMEOUT_MS = 30 * 60 * 1000;

let nextLocalBuildId = 0;

export function createLocalBuildId(now: number): string {
  nextLocalBuildId += 1;
  return `document-build-${now.toString(36)}-${nextLocalBuildId.toString(36)}`;
}

export function createInitialSnapshot(
  identity: BuildDocumentIdentity,
  request: DocumentBuildRequest,
  runtime: DocumentBuildRuntime,
  callbacks?: DocumentBuildCallbacks,
): DocumentBuildSnapshot {
  const submittedAt = request.submitted_at ?? runtime.now?.() ?? Date.now();
  const buildTimeout = request.build_timeout_ms ?? DEFAULT_BUILD_TIMEOUT_MS;
  if (!Number.isFinite(buildTimeout) || buildTimeout <= 0) {
    throw new Error("build_timeout_ms must be a positive finite number");
  }
  const snapshot: DocumentBuildSnapshot = {
    build_id: request.build_id ?? createLocalBuildId(submittedAt),
    request_id: request.request_id,
    generation: request.generation,
    identity,
    state: "queued",
    seq: 0,
    submitted_at: submittedAt,
    build_timeout_ms: buildTimeout,
    force: request.force ?? false,
    stages: [],
    diagnostics: [],
    dependencies: [],
    artifacts: [],
  };
  emitSnapshot(snapshot, callbacks);
  const startedAt = runtime.now?.() ?? Date.now();
  snapshot.state = "running";
  snapshot.started_at = startedAt;
  snapshot.deadline_at = startedAt + buildTimeout;
  emitSnapshot(snapshot, callbacks);
  return snapshot;
}

export function failSnapshot(
  snapshot: DocumentBuildSnapshot,
  runtime: DocumentBuildRuntime,
  diagnostic: BuildDiagnostic,
  callbacks?: DocumentBuildCallbacks,
): DocumentBuildSnapshot {
  snapshot.diagnostics.push(diagnostic);
  snapshot.state = "failed";
  snapshot.exit_code = 1;
  snapshot.error = diagnostic.message;
  snapshot.ended_at = runtime.now?.() ?? Date.now();
  emitSnapshot(snapshot, callbacks);
  return copySnapshot(snapshot);
}

export function copySnapshot(
  snapshot: DocumentBuildSnapshot,
): DocumentBuildSnapshot {
  return {
    ...snapshot,
    identity: { ...snapshot.identity },
    stages: snapshot.stages.map((stage) => ({
      ...stage,
      args: stage.args?.slice(),
      env: stage.env == null ? undefined : { ...stage.env },
      stats: stage.stats?.map((stat) => ({ ...stat })),
    })),
    diagnostics: snapshot.diagnostics.map((diagnostic) => ({ ...diagnostic })),
    dependencies: snapshot.dependencies.slice(),
    artifacts: snapshot.artifacts.map((artifact) => ({ ...artifact })),
  };
}

export function emitSnapshot(
  snapshot: DocumentBuildSnapshot,
  callbacks?: DocumentBuildCallbacks,
): void {
  snapshot.seq += 1;
  callbacks?.onSnapshot?.(copySnapshot(snapshot));
}

export function remainingTimeoutSeconds(
  snapshot: DocumentBuildSnapshot,
  runtime: DocumentBuildRuntime,
  stageDefault: number,
): number {
  const now = runtime.now?.() ?? Date.now();
  const remainingMs = (snapshot.deadline_at ?? now) - now;
  return Math.max(1, Math.min(stageDefault, Math.ceil(remainingMs / 1000)));
}

function stageFailureDiagnostic(stage: BuildStageResult): BuildDiagnostic {
  const source = stage.name === "patch-synctex" ? "knitr" : stage.name;
  const message =
    stage.error ??
    stage.stderr.trim().split("\n")[0] ??
    stage.stdout.trim().split("\n")[0] ??
    `${stage.name} failed`;
  return {
    level: "error",
    source,
    message: message || `${stage.name} failed`,
    stage_id: stage.stage_id,
  };
}

export function terminalStateForStage(
  stage: BuildStageResult,
): DocumentBuildState | undefined {
  if (stage.state === "canceled") return "canceled";
  if (stage.state === "timed_out") return "timed_out";
  if (stage.state === "failed" || (stage.exit_code ?? 0) !== 0) {
    return "failed";
  }
  return undefined;
}

export function deadlineExpired(
  snapshot: DocumentBuildSnapshot,
  runtime: DocumentBuildRuntime,
): boolean {
  return (
    snapshot.deadline_at != null &&
    (runtime.now?.() ?? Date.now()) >= snapshot.deadline_at
  );
}

export async function executeStage(
  snapshot: DocumentBuildSnapshot,
  runtime: DocumentBuildRuntime,
  spec: BuildStageSpec,
  callbacks?: DocumentBuildCallbacks,
): Promise<BuildStageResult> {
  if (deadlineExpired(snapshot, runtime)) {
    const now = runtime.now?.() ?? Date.now();
    const timedOut: BuildStageResult = {
      ...spec,
      state: "timed_out",
      started_at: now,
      ended_at: now,
      exit_code: 124,
      stdout: "",
      stderr: "Build deadline expired before this stage started.",
    };
    snapshot.stages.push(timedOut);
    callbacks?.onStage?.({ type: "finished", stage: { ...timedOut } });
    emitSnapshot(snapshot, callbacks);
    return timedOut;
  }

  const started: BuildStageResult = {
    ...spec,
    state: "running",
    started_at: runtime.now?.() ?? Date.now(),
    stdout: "",
    stderr: "",
  };
  snapshot.stages.push(started);
  callbacks?.onStage?.({ type: "started", stage: { ...started } });
  emitSnapshot(snapshot, callbacks);

  const index = snapshot.stages.length - 1;
  const onEvent = (event: BuildStageEvent): void => {
    const stage = { ...spec, ...event.stage };
    snapshot.stages[index] = stage;
    callbacks?.onStage?.({ type: event.type, stage: { ...stage } });
    emitSnapshot(snapshot, callbacks);
  };

  try {
    const result = { ...spec, ...(await runtime.execute(spec, onEvent)) };
    snapshot.stages[index] = result;
    callbacks?.onStage?.({ type: "finished", stage: { ...result } });
    emitSnapshot(snapshot, callbacks);
    return result;
  } catch (error) {
    const failed: BuildStageResult = {
      ...started,
      state: "failed",
      ended_at: runtime.now?.() ?? Date.now(),
      exit_code: 1,
      error: `${error}`,
      stderr: `${error}`,
    };
    snapshot.stages[index] = failed;
    snapshot.diagnostics.push({
      ...stageFailureDiagnostic(failed),
      source: "transport",
    });
    callbacks?.onStage?.({ type: "finished", stage: { ...failed } });
    emitSnapshot(snapshot, callbacks);
    return failed;
  }
}

export function finishSnapshot(
  snapshot: DocumentBuildSnapshot,
  runtime: DocumentBuildRuntime,
  callbacks?: DocumentBuildCallbacks,
): DocumentBuildSnapshot {
  const requiredFailure = snapshot.stages.find(
    (stage) => stage.required && terminalStateForStage(stage) != null,
  );
  const parsedFailure = snapshot.diagnostics.some(
    (diagnostic) => diagnostic.level === "error",
  );

  if (requiredFailure != null) {
    snapshot.state = terminalStateForStage(requiredFailure) ?? "failed";
    snapshot.exit_code =
      snapshot.state === "timed_out" ? 124 : (requiredFailure.exit_code ?? 1);
    if (
      !snapshot.diagnostics.some(
        (diagnostic) => diagnostic.stage_id === requiredFailure.stage_id,
      )
    ) {
      snapshot.diagnostics.push(stageFailureDiagnostic(requiredFailure));
    }
  } else if (parsedFailure) {
    snapshot.state = "failed";
    snapshot.exit_code = 1;
  } else {
    snapshot.state = "succeeded";
    snapshot.exit_code = 0;
  }
  snapshot.ended_at = runtime.now?.() ?? Date.now();
  emitSnapshot(snapshot, callbacks);
  return copySnapshot(snapshot);
}
