// Keep account credentials outside the project-home mount. Nested file mounts
// below /home/user can be shadowed by the project bind mount in rootless Podman.
export const PROJECT_RUNTIME_SUBSCRIPTION_CODEX_HOME =
  "/run/cocalc/codex-subscription";
