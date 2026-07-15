/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import {
  decryptProjectSecretValue,
  type ProjectSecretsRuntimeCache,
} from "@cocalc/util/project-secrets";
import {
  getCachedProjectSecretsState,
  getCachedProjectSecrets,
  markCachedProjectSecretsMaterialized,
  replaceCachedProjectSecrets,
} from "./sqlite/project-secrets";

let projectSecretsKey: Buffer | undefined;

export function hasProjectSecretsCacheKey(): boolean {
  return projectSecretsKey != null;
}

export function resetProjectSecretsCacheKeyForTesting(): void {
  projectSecretsKey = undefined;
}

export function setProjectSecretsCacheKey(key_base64: string): void {
  const key = Buffer.from(`${key_base64 ?? ""}`, "base64");
  if (key.length !== 32) {
    throw new Error("invalid project secrets cache key");
  }
  projectSecretsKey = key;
}

export function syncProjectSecretsCache({
  project_id,
  cache,
}: {
  project_id: string;
  cache: ProjectSecretsRuntimeCache;
}): {
  accepted: boolean;
  secret_names: string[];
  cached_generation: number;
  materialized_generation: number;
} {
  setProjectSecretsCacheKey(cache.key_base64);
  const current = getCachedProjectSecretsState(project_id);
  // Older hubs did not include a generation. Treat each legacy snapshot as a
  // new local generation so a project-host can be upgraded before the hub, or
  // continue serving safely if the hub is rolled back.
  const generation =
    Number.isSafeInteger(cache.generation) && cache.generation >= 0
      ? cache.generation
      : current.cached_generation + 1;
  const { accepted, state } = replaceCachedProjectSecrets({
    project_id,
    generation,
    entries: cache.entries,
  });
  return {
    accepted,
    secret_names: getCachedProjectSecrets(project_id)
      .map(({ name }) => name)
      .sort(),
    cached_generation: state.cached_generation,
    materialized_generation: state.materialized_generation,
  };
}

export function getProjectSecretsCacheState(project_id: string) {
  return getCachedProjectSecretsState(project_id);
}

export function markProjectSecretsCacheMaterialized({
  project_id,
  generation,
}: {
  project_id: string;
  generation: number;
}) {
  return markCachedProjectSecretsMaterialized({ project_id, generation });
}

export function getCachedProjectSecretsForRuntime({
  project_id,
}: {
  project_id: string;
}): Record<string, string> | undefined {
  if (!projectSecretsKey) {
    return undefined;
  }
  const rows = getCachedProjectSecrets(project_id);
  return Object.fromEntries(
    rows.map((row) => [
      row.name,
      decryptProjectSecretValue({
        project_id,
        name: row.name,
        encrypted: row.encrypted_value,
        key: projectSecretsKey!,
      }),
    ]),
  );
}
