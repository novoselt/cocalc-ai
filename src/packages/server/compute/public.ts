/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

export function publicComputeVmMetadata(
  metadata: Record<string, any> | null | undefined,
): Record<string, any> {
  const {
    ssh_public_keys: _sshPublicKeys,
    project_ssh_public_keys: _projectSshPublicKeys,
    provider_observation: _providerObservation,
    runtime,
    ...publicMetadata
  } = metadata ?? {};
  if (runtime == null || typeof runtime !== "object") return publicMetadata;
  const {
    ssh_public_key: _runtimeSshPublicKey,
    ssh_public_keys: _runtimeSshPublicKeys,
    project_ssh_public_keys: _runtimeProjectSshPublicKeys,
    ...publicRuntime
  } = runtime;
  return { ...publicMetadata, runtime: publicRuntime };
}
