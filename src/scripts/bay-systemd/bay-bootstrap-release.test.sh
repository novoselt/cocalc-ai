#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/bay-bootstrap-release.sh"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

INSTALL_BASE="${TMP_ROOT}/bay"
RELEASES_DIR="${INSTALL_BASE}/releases"
CURRENT_LINK="${INSTALL_BASE}/current"
BAY_ROOT="${TMP_ROOT}/state-root"
COCALC_BAY_PROC_ROOT="${TMP_ROOT}/proc"
# shellcheck disable=SC2034
RETAIN_RELEASES=2

mkdir -p "${RELEASES_DIR}" "${BAY_ROOT}/state" "${COCALC_BAY_PROC_ROOT}/123"
for release in \
  050-stale \
  100-live-hub \
  200-static \
  300-static \
  400-static \
  500-static; do
  mkdir -p "${RELEASES_DIR}/${release}"
done

ln -s "${RELEASES_DIR}/500-static" "$CURRENT_LINK"
printf '%s\n' 400-static > "${BAY_ROOT}/state/previous-version"
ln -s "${RELEASES_DIR}/100-live-hub" "${COCALC_BAY_PROC_ROOT}/123/cwd"

prune_old_releases

grep -q '^COCALC_LOCAL_PG_ARCHIVE=1$' "${SCRIPT_DIR}/env/bay.env.example"
grep -q '^COCALC_LOCAL_PG_ARCHIVE_TIMEOUT=1h$' "${SCRIPT_DIR}/env/bay.env.example"

for release in 100-live-hub 400-static 500-static; do
  if [[ ! -d "${RELEASES_DIR}/${release}" ]]; then
    echo "expected retained release is missing: ${release}" >&2
    exit 1
  fi
done

for release in 050-stale 200-static 300-static; do
  if [[ -e "${RELEASES_DIR}/${release}" ]]; then
    echo "expected stale release still exists: ${release}" >&2
    exit 1
  fi
done

echo "bay release pruning test passed"
