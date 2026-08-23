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
import { extractFrontmatter } from "../markdown";
import {
  createInitialSnapshot,
  executeStage,
  failSnapshot,
  finishSnapshot,
  remainingTimeoutSeconds,
  terminalStateForStage,
} from "../pipeline";
import { deriveMarkdownArtifacts } from "../produced-files";
import { rMarkdownStage } from "./command";
import { markdownFailureDiagnostic } from "./diagnostics";

export async function runRMarkdownPipeline(
  identity: BuildDocumentIdentity,
  request: DocumentBuildRequest,
  runtime: DocumentBuildRuntime,
  callbacks?: DocumentBuildCallbacks,
): Promise<DocumentBuildSnapshot> {
  const snapshot = createInitialSnapshot(identity, request, runtime, callbacks);
  let source: string;
  try {
    source = await runtime.readText(identity.logical_path);
  } catch (error) {
    return failSnapshot(
      snapshot,
      runtime,
      {
        level: "error",
        source: "transport",
        file: identity.logical_path,
        message: error instanceof Error ? error.message : `${error}`,
      },
      callbacks,
    );
  }
  const stage = await executeStage(
    snapshot,
    runtime,
    rMarkdownStage({
      stageId: "r-markdown-1",
      path: identity.logical_path,
      resourceKey: identity.resource_key,
      frontmatter: extractFrontmatter(source),
      timeoutS: remainingTimeoutSeconds(snapshot, runtime, 4 * 60),
      aggregateKey: request.force ? undefined : request.generation,
    }),
    callbacks,
  );
  if (terminalStateForStage(stage) != null) {
    snapshot.diagnostics.push(
      markdownFailureDiagnostic({
        source: "r-markdown",
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
