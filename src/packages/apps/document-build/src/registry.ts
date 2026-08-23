/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type {
  BuildDocumentIdentity,
  DocumentBuildCapabilities,
  DocumentBuildDefinition,
  DocumentBuildRequest,
  DocumentBuildRuntime,
  DocumentBuildCallbacks,
  DocumentBuildSnapshot,
  DocumentKind,
} from "./contracts";
import { runLatexPipeline } from "./latex/pipeline";
import { filename_extension, replaceExtension } from "./path";
import { runQuartoPipeline } from "./quarto/pipeline";
import { runRMarkdownPipeline } from "./rmarkdown/pipeline";

function identity(
  kind: DocumentKind,
  logicalPath: string,
): BuildDocumentIdentity {
  if (kind === "knitr") {
    const workingPath = replaceExtension(logicalPath, "tex");
    return {
      kind,
      logical_path: logicalPath,
      working_path: workingPath,
      resource_key: workingPath,
    };
  }
  if (kind === "r-markdown" || kind === "quarto") {
    return {
      kind,
      logical_path: logicalPath,
      working_path: logicalPath,
      resource_key: replaceExtension(logicalPath, "document-output"),
    };
  }
  return {
    kind,
    logical_path: logicalPath,
    working_path: logicalPath,
    resource_key: logicalPath,
  };
}

function definition(
  kind: DocumentKind,
  extensions: readonly string[],
  pipeline: (
    identity: BuildDocumentIdentity,
    request: DocumentBuildRequest,
    runtime: DocumentBuildRuntime,
    callbacks?: DocumentBuildCallbacks,
  ) => Promise<DocumentBuildSnapshot>,
): DocumentBuildDefinition {
  return {
    kind,
    extensions,
    resolveIdentity: (path) => identity(kind, path),
    run: (request, runtime, callbacks) =>
      pipeline(identity(kind, request.path), request, runtime, callbacks),
  };
}

export const DOCUMENT_BUILD_DEFINITIONS: readonly DocumentBuildDefinition[] = [
  definition("latex", ["tex"], runLatexPipeline),
  definition("knitr", ["rnw", "rtex"], runLatexPipeline),
  definition("r-markdown", ["rmd"], runRMarkdownPipeline),
  definition("quarto", ["qmd"], runQuartoPipeline),
];

export function getDocumentBuildDefinition(
  path: string,
): DocumentBuildDefinition | undefined {
  const extension = filename_extension(path).toLowerCase();
  return DOCUMENT_BUILD_DEFINITIONS.find((entry) =>
    entry.extensions.includes(extension),
  );
}

export function resolveDocumentIdentity(path: string): BuildDocumentIdentity {
  if (!path.trim()) throw new Error("Document path must not be empty.");
  const entry = getDocumentBuildDefinition(path);
  if (entry == null) {
    throw new Error(
      `Unsupported document extension '.${filename_extension(path)}'.`,
    );
  }
  return entry.resolveIdentity(path);
}

export function documentBuildCapabilities(): DocumentBuildCapabilities {
  const kinds = DOCUMENT_BUILD_DEFINITIONS.map((entry) => ({
    kind: entry.kind,
    extensions: [...entry.extensions],
  }));
  return {
    kinds,
    extensions: kinds.flatMap((entry) => entry.extensions),
    supports_cancel: true,
    supports_build_timeout: true,
  };
}

export const getDocumentBuildCapabilities = documentBuildCapabilities;
