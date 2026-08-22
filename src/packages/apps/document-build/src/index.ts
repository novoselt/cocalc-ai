/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export * from "./contracts";
export * from "./runtime";
export * from "./registry";
export * from "./pipeline";
export * from "./config";
export * from "./produced-files";
export * from "./latex/commands";
export * from "./latex/config";
export * from "./latex/knitr";
export * from "./latex/log-parser";
export * from "./latex/pythontex";
export * from "./latex/sagetex";
export * from "./rmarkdown/command";
export * from "./rmarkdown/diagnostics";
export * from "./quarto/command";

import type {
  DocumentBuildCallbacks,
  DocumentBuildRequest,
  DocumentBuildRuntime,
  DocumentBuildSnapshot,
} from "./contracts";
import { hash_string } from "@cocalc/util/misc";
import { createInitialSnapshot, failSnapshot } from "./pipeline";
import { getDocumentBuildDefinition } from "./registry";

export async function runDocumentBuild(
  request: DocumentBuildRequest,
  runtime: DocumentBuildRuntime,
  callbacks?: DocumentBuildCallbacks,
): Promise<DocumentBuildSnapshot> {
  const definition = getDocumentBuildDefinition(request.path);
  if (definition == null) {
    const extension = request.path.split(".").pop() ?? "";
    throw new Error(`Unsupported document extension '.${extension}'.`);
  }
  if (request.expected_source_hash != null) {
    const identity = definition.resolveIdentity(request.path);
    try {
      const actual = hash_string(await runtime.readText(request.path));
      if (actual !== request.expected_source_hash) {
        const snapshot = createInitialSnapshot(
          identity,
          request,
          runtime,
          callbacks,
        );
        return failSnapshot(
          snapshot,
          runtime,
          {
            level: "error",
            source: "configuration",
            file: request.path,
            message:
              "The saved document changed before the build started; save again and retry.",
          },
          callbacks,
        );
      }
    } catch (error) {
      const snapshot = createInitialSnapshot(
        identity,
        request,
        runtime,
        callbacks,
      );
      return failSnapshot(
        snapshot,
        runtime,
        {
          level: "error",
          source: "transport",
          file: request.path,
          message: error instanceof Error ? error.message : `${error}`,
        },
        callbacks,
      );
    }
  }
  return await definition.run(request, runtime, callbacks);
}
