#!/usr/bin/env bash
set -Eeuo pipefail

NAME="cocalc-cli"
VERSION="${COCALC_SOFTWARE_ARTIFACT_ID:-$(node -p "require('../package.json').version")}"
MACHINE="$(uname -m)"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"

case "$MACHINE" in
  x86_64|amd64) ARCH="amd64" ;;
  aarch64|arm64) ARCH="arm64" ;;
  *)
    echo "Unsupported arch: $MACHINE" >&2
    exit 1
    ;;
esac

SEA_DIR="../build/sea"
TARGET="${NAME}-${VERSION}-${MACHINE}-${OS}"
FILE="${SEA_DIR}/${TARGET}"

if [ ! -f "$FILE" ]; then
  echo "SEA artifact not found: $FILE" >&2
  echo "Run: pnpm run sea" >&2
  exit 1
fi

case "$OS" in
  linux)
    PUBLISH_FILE="${FILE}.tar.gz"
    CONTENT_TYPE="application/gzip"
    if [[ ! -f "$PUBLISH_FILE" ]]; then
      echo "Linux runtime bundle not found: $PUBLISH_FILE" >&2
      echo "Run: pnpm run sea" >&2
      exit 1
    fi
    ;;
  darwin)
    PUBLISH_FILE="$FILE"
    CONTENT_TYPE="application/octet-stream"
    ;;
  *)
    echo "Unsupported OS: $OS" >&2
    exit 1
    ;;
esac

LATEST_KEY="${COCALC_R2_LATEST_KEY:-software/cocalc/latest-${OS}-${ARCH}.json}"
PREFIX="${COCALC_R2_PREFIX:-software/cocalc/$VERSION}"

node ../../cloud/scripts/publish-r2.js \
  --file "$PUBLISH_FILE" \
  --bucket "${COCALC_R2_BUCKET:-}" \
  --prefix "$PREFIX" \
  --latest-key "$LATEST_KEY" \
  --public-base-url "${COCALC_R2_PUBLIC_BASE_URL:-}" \
  --os "$OS" \
  --arch "$ARCH" \
  --version "$VERSION" \
  --content-type "$CONTENT_TYPE"
