#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

cat > "${TMP_ROOT}/curl" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
url="${*: -1}"
if [[ "${COCALC_TEST_CURL_MODE:-}" == "diagnostics" ]]; then
  if [[ "$url" == */diagnostics ]]; then
    printf '%s\n' '{"process":{"startup":{"phase":"passport","elapsed_ms":91234}}}'
    exit 0
  fi
  exit 1
fi
count_file="${COCALC_TEST_CURL_COUNT_FILE:?}"
count=0
if [[ -r "$count_file" ]]; then
  count="$(cat "$count_file")"
fi
count=$((count + 1))
printf '%s\n' "$count" > "$count_file"
((count >= 7))
EOF
chmod +x "${TMP_ROOT}/curl"

count_file="${TMP_ROOT}/curl-count"
PATH="${TMP_ROOT}:${PATH}" \
COCALC_TEST_CURL_COUNT_FILE="$count_file" \
COCALC_BAY_ENV_FILE="${TMP_ROOT}/missing-bay.env" \
COCALC_BAY_WORKERS_ENV_FILE="${TMP_ROOT}/missing-workers.env" \
COCALC_BAY_OVERLAY_ENV_FILE="${TMP_ROOT}/missing-overlay.env" \
COCALC_BAY_TOPOLOGY_ENV_FILE="${TMP_ROOT}/missing-topology.env" \
COCALC_BAY_SECRETS_ENV_FILE="${TMP_ROOT}/missing-secrets.env" \
COCALC_BAY_LOCAL_ENV_FILE="${TMP_ROOT}/missing-local.env" \
COCALC_BAY_HEALTH_TIMEOUT_S=1 \
COCALC_BAY_WORKER_START_TIMEOUT_S=3 \
  "${SCRIPT_DIR}/bay-worker-health" 1

if [[ "$(cat "$count_file")" -lt 7 ]]; then
  echo "worker health did not use the longer startup timeout" >&2
  exit 1
fi

set +e
failure_output="$(
  PATH="${TMP_ROOT}:${PATH}" \
  COCALC_TEST_CURL_MODE=diagnostics \
  COCALC_BAY_ENV_FILE="${TMP_ROOT}/missing-bay.env" \
  COCALC_BAY_WORKERS_ENV_FILE="${TMP_ROOT}/missing-workers.env" \
  COCALC_BAY_OVERLAY_ENV_FILE="${TMP_ROOT}/missing-overlay.env" \
  COCALC_BAY_TOPOLOGY_ENV_FILE="${TMP_ROOT}/missing-topology.env" \
  COCALC_BAY_SECRETS_ENV_FILE="${TMP_ROOT}/missing-secrets.env" \
  COCALC_BAY_LOCAL_ENV_FILE="${TMP_ROOT}/missing-local.env" \
  COCALC_BAY_HEALTH_TIMEOUT_S=1 \
  COCALC_BAY_WORKER_START_TIMEOUT_S=1 \
    "${SCRIPT_DIR}/bay-worker-health" 2 2>&1
)"
failure_status=$?
set -e

if [[ "$failure_status" -eq 0 ]]; then
  echo "worker health unexpectedly succeeded in diagnostics failure test" >&2
  exit 1
fi
if [[ "$failure_output" != *'"phase":"passport"'* ]]; then
  echo "worker health did not report startup diagnostics: $failure_output" >&2
  exit 1
fi

echo "bay worker startup health timeout test passed"
