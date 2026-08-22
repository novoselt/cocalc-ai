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
  return await definition.run(request, runtime, callbacks);
}
