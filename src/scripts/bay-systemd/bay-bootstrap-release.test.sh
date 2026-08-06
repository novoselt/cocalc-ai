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

PREVIOUS_RELEASE="${TMP_ROOT}/previous-release"
TARGET_RELEASE="${TMP_ROOT}/target-release"
PREVIOUS_CDN="${PREVIOUS_RELEASE}/runtime/control-plane/cdn"
TARGET_CDN="${TARGET_RELEASE}/runtime/control-plane/cdn"
mkdir -p \
  "${PREVIOUS_CDN}/codemirror" \
  "${PREVIOUS_CDN}/codemirror-0.9" \
  "${TARGET_CDN}/codemirror"
printf '%s\n' old >"${PREVIOUS_CDN}/codemirror/content.txt"
printf '%s\n' historic >"${PREVIOUS_CDN}/codemirror-0.9/content.txt"
printf '%s\n' new >"${TARGET_CDN}/codemirror/content.txt"
ln -s codemirror "${PREVIOUS_CDN}/codemirror-1.0"
ln -s codemirror "${TARGET_CDN}/codemirror-2.0"
cat >"${PREVIOUS_CDN}/index.js" <<'EOF'
exports.versions = { codemirror: "1.0" };
EOF
cat >"${TARGET_CDN}/index.js" <<'EOF'
exports.versions = { codemirror: "2.0" };
EOF

preserve_previous_cdn_assets "$PREVIOUS_RELEASE"

if [[ "$(cat "${TARGET_CDN}/codemirror-2.0/content.txt")" != "new" ]]; then
  echo "current CDN version was overwritten" >&2
  exit 1
fi
if [[ "$(cat "${TARGET_CDN}/codemirror-1.0/content.txt")" != "old" ]]; then
  echo "previous CDN version was not retained" >&2
  exit 1
fi
if [[ -L "${TARGET_CDN}/codemirror-1.0" ]]; then
  echo "previous CDN version must be retained as a real directory" >&2
  exit 1
fi
if [[ "$(cat "${TARGET_CDN}/codemirror-0.9/content.txt")" != "historic" ]]; then
  echo "historic CDN version was not retained" >&2
  exit 1
fi

echo "bay release pruning and CDN retention tests passed"
