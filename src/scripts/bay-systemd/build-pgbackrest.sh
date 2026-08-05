#!/usr/bin/env bash
# Build pgBackRest on a disposable build host. Copy the resulting single
# executable to bay hosts; do not install compiler dependencies in production.
set -euo pipefail

VERSION="2.59.0"
SHA256="faaf8faa14a6392279654ee216a493fcd07b0c513af4b55fe34faec062cb8875"
OUTPUT="${PWD}/pgbackrest-${VERSION}-linux-$(uname -m)"
INSTALL_DEPS=0

usage() {
  cat <<EOF
Usage: build-pgbackrest.sh [--output PATH] [--install-deps]

Build checksum-verified pgBackRest ${VERSION} from its official distribution
tarball and run the upstream smoke test. Use a disposable Ubuntu 24.04 build
host with PostgreSQL installed so the smoke test exercises backup and restore.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --output)
      OUTPUT="$2"
      shift 2
      ;;
    --install-deps)
      INSTALL_DEPS=1
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "unknown argument: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

if [[ "$INSTALL_DEPS" == "1" ]]; then
  sudo apt-get update
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y \
    build-essential ca-certificates curl meson ninja-build pkg-config \
    libbz2-dev liblz4-dev libpq-dev libssh2-1-dev libssl-dev libsystemd-dev \
    libxml2-dev libz-dev libzstd-dev postgresql
fi

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
# The upstream smoke suite drops privileges to postgres when run through sudo.
# Permit traversal of the disposable build root without making files writable.
chmod 0755 "$work"
archive="$work/pgbackrest-${VERSION}.tar.gz"
url="https://github.com/pgbackrest/pgbackrest/releases/download/release%2F${VERSION}/pgbackrest-${VERSION}.tar.gz"
curl -fsSL "$url" -o "$archive"
printf '%s  %s\n' "$SHA256" "$archive" | sha256sum -c -
tar -xzf "$archive" -C "$work"
meson setup "$work/build" "$work/pgbackrest-${VERSION}"
ninja -C "$work/build"
sudo meson test -C "$work/build" --suite smoke --print-errorlogs
install -m 0755 "$work/build/src/pgbackrest" "$OUTPUT"
"$OUTPUT" version
sha256sum "$OUTPUT" > "${OUTPUT}.sha256sum"
printf 'Built %s\nChecksum: %s\n' "$OUTPUT" "${OUTPUT}.sha256sum"
