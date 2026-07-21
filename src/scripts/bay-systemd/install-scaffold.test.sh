#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

printf '%s\n' 'COCALC_BAY_FRONTDOOR_HOST=127.0.0.1' > "${TMP_ROOT}/bay.env"
printf '%s\n' 'COCALC_BAY_FRONTDOOR_HOST=192.0.2.10' > "${TMP_ROOT}/bay-overlay.env"
printf '%s\n' \
  'COCALC_BAY_FRONTDOOR_HOST=0.0.0.0' \
  'COCALC_BAY_PUBLIC_INGRESS_MODE=cloudflare-proxy' > "${TMP_ROOT}/bay-local.env"

loaded="$({
  COCALC_BAY_ENV_FILE="${TMP_ROOT}/bay.env" \
  COCALC_BAY_WORKERS_ENV_FILE="${TMP_ROOT}/missing-workers.env" \
  COCALC_BAY_OVERLAY_ENV_FILE="${TMP_ROOT}/bay-overlay.env" \
  COCALC_BAY_TOPOLOGY_ENV_FILE="${TMP_ROOT}/missing-topology.env" \
  COCALC_BAY_SECRETS_ENV_FILE="${TMP_ROOT}/missing-secrets.env" \
  COCALC_BAY_LOCAL_ENV_FILE="${TMP_ROOT}/bay-local.env" \
    bash -c 'source "$1"; printf "%s %s" "$COCALC_BAY_FRONTDOOR_HOST" "$COCALC_BAY_PUBLIC_INGRESS_MODE"' \
      bash "${SCRIPT_DIR}/bin/lib.sh"
})"
if [[ "$loaded" != "0.0.0.0 cloudflare-proxy" ]]; then
  echo "bay-local.env did not override generated environment files: $loaded" >&2
  exit 1
fi

TARGET_ROOT="${TMP_ROOT}/rootfs"
bash "${SCRIPT_DIR}/install-scaffold.sh" --root "$TARGET_ROOT" >/dev/null
LOCAL_ENV="${TARGET_ROOT}/etc/cocalc/bay-local.env"
[[ -f "$LOCAL_ENV" ]]
[[ "$(stat -c '%a' "$LOCAL_ENV")" == "644" ]]
printf '%s\n' 'COCALC_BAY_FRONTDOOR_HOST=0.0.0.0' > "$LOCAL_ENV"

bash "${SCRIPT_DIR}/install-scaffold.sh" --root "$TARGET_ROOT" >/dev/null
grep -qx 'COCALC_BAY_FRONTDOOR_HOST=0.0.0.0' "$LOCAL_ENV"

echo "bay scaffold local environment tests passed"
