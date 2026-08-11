#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck disable=SC1091
source "${SCRIPT_DIR}/bay-bootstrap-release.sh"

TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

ORIGINAL_NODE="$(command -v node)"
NODE_VERSION="test"
NVM_DIR="${TMP_ROOT}/nvm"
mkdir -p "${NVM_DIR}/versions/node/v${NODE_VERSION}/bin"
ln -s "$ORIGINAL_NODE" "${NVM_DIR}/versions/node/v${NODE_VERSION}/bin/node"
if [[ "$(PATH=/nonexistent find_node)" != "${NVM_DIR}/versions/node/v${NODE_VERSION}/bin/node" ]]; then
  echo "configured Node runtime was not resolved when node was absent from PATH" >&2
  exit 1
fi

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

VALIDATION_RELEASE="${TMP_ROOT}/validation-release"
TARGET_RELEASE="$VALIDATION_RELEASE"
OVERLAY_MODE="rocket-bundle"
HUB_BUNDLE_PATH="${TMP_ROOT}/hub.tar.xz"
STATIC_BUNDLE_PATH=""
for required_file in \
  scripts/bay-systemd/install-scaffold.sh \
  scripts/bay-systemd/env/bay-rocket-bundle-overlay.env.example \
  scripts/bay-systemd/needrestart/cocalc-bay.conf \
  runtime/project-host/index.js \
  runtime/control-plane/bundle/index.js \
  runtime/control-plane/http-api-dist/pages/api/v2/index.js \
  runtime/migrate-schema/index.js \
  runtime/control-plane/static/public.html \
  runtime/control-plane/public/cocalc-content.css \
  runtime/control-plane/webapp/favicon.ico \
  runtime/control-plane/bundle/gcp/gcp-setup.sh \
  runtime/control-plane/bundle/gcp/compute-vm-setup.sh \
  runtime/control-plane/bundle/nebius/nebius-setup.sh; do
  mkdir -p "${VALIDATION_RELEASE}/$(dirname "$required_file")"
  touch "${VALIDATION_RELEASE}/${required_file}"
done
chmod +x "${VALIDATION_RELEASE}/scripts/bay-systemd/install-scaffold.sh"

rm "${VALIDATION_RELEASE}/scripts/bay-systemd/needrestart/cocalc-bay.conf"
if (validate_release >/dev/null 2>&1); then
  echo "release unexpectedly passed without the needrestart policy" >&2
  exit 1
fi
touch "${VALIDATION_RELEASE}/scripts/bay-systemd/needrestart/cocalc-bay.conf"

NEEDRESTART_POLICY_PATH="${TMP_ROOT}/etc/needrestart/conf.d/cocalc-bay.conf"
printf '%s\n' 'test needrestart policy' \
  >"${VALIDATION_RELEASE}/scripts/bay-systemd/needrestart/cocalc-bay.conf"
install_needrestart_policy >/dev/null
if [[ "$(cat "$NEEDRESTART_POLICY_PATH")" != "test needrestart policy" ]]; then
  echo "static release needrestart policy was not installed" >&2
  exit 1
fi

# Hub-only releases must remain deployable over static releases that predate
# the bundled CDN. Static and full releases still fail closed without it.
validate_release
HUB_BUNDLE_PATH=""
if (validate_release >/dev/null 2>&1); then
  echo "non-hub release unexpectedly passed without CDN assets" >&2
  exit 1
fi
mkdir -p "${VALIDATION_RELEASE}/runtime/control-plane/cdn/pdfjs-dist/cmaps"
touch "${VALIDATION_RELEASE}/runtime/control-plane/cdn/pdfjs-dist/cmaps/UniJIS-UTF16-H.bcmap"
validate_release

echo "bay release pruning and CDN retention tests passed"
