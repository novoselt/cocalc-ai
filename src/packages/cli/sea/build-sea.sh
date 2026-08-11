#!/usr/bin/env bash
set -euo pipefail

ROOT="$(realpath "$(dirname "$0")/../../..")"
SEA_DIR="$(realpath "$(dirname "$0")")"
BUILD_DIR="$ROOT/packages/cli/build/sea"
BUNDLE_ENTRY="$ROOT/packages/cli/build/bundle/index.js"
NAME="cocalc-cli"
# shellcheck source=../../project-host/sea/node-bin.sh
source "$ROOT/packages/project-host/sea/node-bin.sh"
NODE_BIN="$(resolve_sea_node_bin)"
VERSION="${COCALC_SOFTWARE_ARTIFACT_ID:-${npm_package_version:-$("$NODE_BIN" -p "require('$ROOT/packages/cli/package.json').version")}}"
MACHINE="$(uname -m)"
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
case "$MACHINE" in
  x86_64 | amd64)
    RELEASE_ARCH="amd64"
    ;;
  aarch64 | arm64)
    RELEASE_ARCH="arm64"
    ;;
  *)
    echo "Unsupported machine architecture: $MACHINE" >&2
    exit 2
    ;;
esac
TARGET="$BUILD_DIR/$NAME-$VERSION-$MACHINE-$OS"
SIGN_ID="${COCALC_CLI_SIGN_ID:-}"
ENTITLEMENTS="${COCALC_CLI_ENTITLEMENTS:-entitlements.plist}"
REQUIRE_DEVELOPER_ID="${COCALC_CLI_REQUIRE_DEVELOPER_ID:-0}"
POSTJECT="${COCALC_POSTJECT_BIN:-$ROOT/packages/cli/node_modules/.bin/postject}"

if [[ ! -x "$POSTJECT" ]]; then
  echo "ERROR: pinned postject executable is unavailable: $POSTJECT" >&2
  echo "Run pnpm install before building the CLI release." >&2
  exit 1
fi

echo "Building CoCalc CLI SEA for $OS/$MACHINE"
echo "Using Node.js $("$NODE_BIN" -p 'process.version') at $NODE_BIN"

"$SEA_DIR/build-bundle.sh"

if [ ! -f "$BUNDLE_ENTRY" ]; then
  echo "ERROR: missing bundle entry: $BUNDLE_ENTRY" >&2
  exit 1
fi

mkdir -p "$BUILD_DIR"
cp "$NODE_BIN" "$TARGET"
chmod u+w "$TARGET"

cp "$BUNDLE_ENTRY" "$SEA_DIR/cocalc.js"

cd "$SEA_DIR"
"$NODE_BIN" --experimental-sea-config sea-config.json

FUSE="$(strings "$NODE_BIN" | rg -o 'NODE_SEA_FUSE_[a-f0-9]+' -m 1 || true)"
if [ -z "$FUSE" ]; then
  echo "ERROR: unable to detect NODE_SEA_FUSE from node binary" >&2
  exit 1
fi

case "$OS" in
  darwin)
    if [[ "$REQUIRE_DEVELOPER_ID" == "1" && -z "$SIGN_ID" ]]; then
      echo "ERROR: release build requires COCALC_CLI_SIGN_ID" >&2
      exit 1
    fi
    codesign --remove-signature "$TARGET" || true
    env -u npm_config_npm_globalconfig \
      -u npm_config_verify_deps_before_run \
      -u npm_config__jsr_registry \
      -u npm_config_enable_pre_post_scripts \
      -u npm_config_package_import_method \
      -u npm_config_git_checks \
      NPM_CONFIG_LOGLEVEL=error \
      "$POSTJECT" "$TARGET" NODE_SEA_BLOB ./sea-prep.blob \
      --sentinel-fuse "$FUSE" \
      --macho-segment-name NODE_SEA
    if [[ -n "$SIGN_ID" ]]; then
      codesign --force --sign "$SIGN_ID" \
        --timestamp \
        --options runtime \
        --entitlements "$ENTITLEMENTS" \
        "$TARGET"
    else
      codesign --force --sign - "$TARGET"
    fi
    ;;
  linux)
    env -u npm_config_npm_globalconfig \
      -u npm_config_verify_deps_before_run \
      -u npm_config__jsr_registry \
      -u npm_config_enable_pre_post_scripts \
      -u npm_config_package_import_method \
      -u npm_config_git_checks \
      NPM_CONFIG_LOGLEVEL=error \
      "$POSTJECT" "$TARGET" NODE_SEA_BLOB ./sea-prep.blob \
      --sentinel-fuse "$FUSE"
    ;;
  *)
    echo "Unsupported OS: $OS" >&2
    exit 2
    ;;
esac

rm -f cocalc.js sea-prep.blob sea.term
ln -sfn "$(basename "$TARGET")" "$BUILD_DIR/$NAME"
if [[ "$OS" == "linux" ]]; then
  "$SEA_DIR/package-linux-runtime.sh" "$TARGET" "$TARGET.tar.gz"
fi

VERIFY_ARGS=(
  --file "$TARGET"
  --os "$OS"
  --arch "$RELEASE_ARCH"
  --release-id "$VERSION"
  --execute
)
if [[ "$OS" == "linux" ]]; then
  VERIFY_ARGS[1]="$TARGET.tar.gz"
elif [[ -n "$SIGN_ID" ]]; then
  VERIFY_ARGS+=(--require-developer-id)
fi
"$NODE_BIN" "$SEA_DIR/verify-release-artifact.mjs" "${VERIFY_ARGS[@]}"

echo "Built $TARGET"
ls -lh "$TARGET"
ls -lh "$BUILD_DIR/$NAME"
if [[ "$OS" == "linux" ]]; then
  ls -lh "$TARGET.tar.gz"
fi
