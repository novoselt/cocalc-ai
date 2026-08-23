/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  DEFAULT_BUILD_TIMEOUT_MS,
  documentBuildCapabilities,
  resolveDocumentIdentity,
  runDocumentBuild,
  type DocumentBuildRequest,
  type DocumentBuildSnapshot,
} from "@cocalc/app-document-build";
import { documentBuildEventsSubject } from "@cocalc/conat/project/document-build";
import { getProjectConatClient } from "@cocalc/project/conat/runtime-client";
import { project_id } from "@cocalc/project/data";
import { getLogger } from "@cocalc/project/logger";
import { normalizeDocumentPath } from "./paths";
import {
  DocumentBuildManager,
  type DocumentBuildExecutionResult,
} from "./manager";
import { ProjectDocumentBuildRuntime } from "./runtime";

const logger = getLogger("project:document-build");

function positiveInteger(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function createManager(): DocumentBuildManager {
  return new DocumentBuildManager({
    capabilities: documentBuildCapabilities,
    resolveIdentity: (path) =>
      resolveDocumentIdentity(normalizeDocumentPath(path)),
    maxActive: positiveInteger("COCALC_DOCUMENT_BUILD_MAX_ACTIVE", 2),
    maxQueued: positiveInteger("COCALC_DOCUMENT_BUILD_MAX_QUEUED", 100),
    completedMax: positiveInteger("COCALC_DOCUMENT_BUILD_RETAIN_MAX", 100),
    completedTtlMs: positiveInteger(
      "COCALC_DOCUMENT_BUILD_RETAIN_TTL_MS",
      60 * 60_000,
    ),
    defaultBuildTimeoutMs: positiveInteger(
      "COCALC_DOCUMENT_BUILD_DEFAULT_TIMEOUT_MS",
      DEFAULT_BUILD_TIMEOUT_MS,
    ),
    maximumBuildTimeoutMs: positiveInteger(
      "COCALC_DOCUMENT_BUILD_MAXIMUM_TIMEOUT_MS",
      24 * 60 * 60_000,
    ),
    publish: (snapshot) => {
      try {
        getProjectConatClient().publishSync(
          documentBuildEventsSubject({ project_id }),
          snapshot,
        );
      } catch (err) {
        logger.debug("unable to publish document build snapshot", {
          build_id: snapshot.build_id,
          err: `${err}`,
        });
      }
    },
    execute: async (request, identity, control) => {
      const runtime = new ProjectDocumentBuildRuntime({
        build_id: request.build_id!,
        signal: control.signal,
        setCancelActive: control.setCancelActive,
      });
      const result = await runDocumentBuild(
        { ...request, path: identity.logical_path },
        runtime,
        {
          onSnapshot: (snapshot) =>
            control.update({
              stages: snapshot.stages,
              diagnostics: snapshot.diagnostics,
              dependencies: snapshot.dependencies,
              artifacts: snapshot.artifacts,
              error: snapshot.error,
            }),
        },
      );
      if (result.state === "queued" || result.state === "running") {
        throw new Error(
          `document pipeline returned nonterminal state '${result.state}'`,
        );
      }
      return {
        state: result.state,
        exit_code: result.exit_code ?? (result.state === "succeeded" ? 0 : 1),
        stages: result.stages,
        diagnostics: result.diagnostics,
        dependencies: result.dependencies,
        artifacts: result.artifacts,
        error: result.error,
      } satisfies DocumentBuildExecutionResult;
    },
  });
}

let manager: DocumentBuildManager | undefined;

export function getDocumentBuildManager(): DocumentBuildManager {
  manager ??= createManager();
  return manager;
}

export function setDocumentBuildManagerForTesting(
  value: DocumentBuildManager | undefined,
): void {
  manager = value;
}

export async function capabilities() {
  return getDocumentBuildManager().capabilities();
}

export async function start(
  request: DocumentBuildRequest,
): Promise<DocumentBuildSnapshot> {
  return getDocumentBuildManager().start(request);
}

export async function get(build_id: string): Promise<DocumentBuildSnapshot> {
  return getDocumentBuildManager().get(build_id);
}

export async function getActive(
  query: { path?: string } = {},
): Promise<DocumentBuildSnapshot[]> {
  return getDocumentBuildManager().getActive(query);
}

export async function getRecent(
  query: { path?: string; limit?: number } = {},
): Promise<DocumentBuildSnapshot[]> {
  return getDocumentBuildManager().getRecent(query);
}

export async function cancel(build_id: string): Promise<DocumentBuildSnapshot> {
  return await getDocumentBuildManager().cancel(build_id);
}
