/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  BuildDocumentIdentity,
  DocumentBuildCallbacks,
  DocumentBuildRequest,
  DocumentBuildRuntime,
  DocumentBuildSnapshot,
} from "../contracts";
import {
  createInitialSnapshot,
  executeStage,
  finishSnapshot,
  remainingTimeoutSeconds,
  terminalStateForStage,
} from "../pipeline";
import { deriveMarkdownArtifacts } from "../produced-files";
import { markdownFailureDiagnostic } from "../rmarkdown/diagnostics";
import { quartoStage } from "./command";

export async function runQuartoPipeline(
  identity: BuildDocumentIdentity,
  request: DocumentBuildRequest,
  runtime: DocumentBuildRuntime,
  callbacks?: DocumentBuildCallbacks,
): Promise<DocumentBuildSnapshot> {
  const snapshot = createInitialSnapshot(identity, request, runtime, callbacks);
  const stage = await executeStage(
    snapshot,
    runtime,
    quartoStage({
      stageId: "quarto-1",
      path: identity.logical_path,
      resourceKey: identity.resource_key,
      timeoutS: remainingTimeoutSeconds(snapshot, runtime, 4 * 60),
      aggregateKey: request.force ? undefined : request.generation,
    }),
    callbacks,
  );
  if (terminalStateForStage(stage) != null) {
    snapshot.diagnostics.push(
      markdownFailureDiagnostic({
        source: "quarto",
        path: identity.logical_path,
        stdout: stage.stdout,
        stderr: stage.stderr,
        stageId: stage.stage_id,
      }),
    );
  } else {
    snapshot.artifacts.push(
      ...(await deriveMarkdownArtifacts(identity.logical_path, runtime)),
    );
  }
  return finishSnapshot(snapshot, runtime, callbacks);
}
