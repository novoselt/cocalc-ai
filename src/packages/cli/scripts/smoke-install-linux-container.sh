#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <cocalc-linux-runtime.tar.gz> [container-image]" >&2
  exit 2
fi

ARTIFACT="$(realpath "$1")"
IMAGE="${2:-ubuntu:26.04}"
CONTAINER_ENGINE="${COCALC_CONTAINER_ENGINE:-docker}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INSTALLER="$(realpath "$SCRIPT_DIR/../install.sh")"

if [[ ! -f "$ARTIFACT" ]]; then
  echo "CLI runtime bundle not found: $ARTIFACT" >&2
  exit 1
fi

if ! command -v "$CONTAINER_ENGINE" >/dev/null 2>&1; then
  echo "Container engine is unavailable: $CONTAINER_ENGINE" >&2
  echo "Set COCALC_CONTAINER_ENGINE=podman to use Podman." >&2
  exit 1
fi

machine="$(uname -m)"
case "$machine" in
  x86_64|amd64) arch="amd64" ;;
  aarch64|arm64) arch="arm64" ;;
  *)
    echo "Unsupported host architecture: $machine" >&2
    exit 1
    ;;
esac

tmpdir="$(mktemp -d)"
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

mkdir -p "$tmpdir/software/cocalc"
cp "$ARTIFACT" "$tmpdir/cocalc-linux-runtime.tar.gz"
cp "$INSTALLER" "$tmpdir/install.sh"
sha256="$(sha256sum "$tmpdir/cocalc-linux-runtime.tar.gz" | awk '{print $1}')"
cat > "$tmpdir/software/cocalc/latest-linux-$arch.json" <<EOF
{
  "url": "file:///fixture/cocalc-linux-runtime.tar.gz",
  "sha256": "$sha256",
  "artifact_id": "container-smoke",
  "version": "container-smoke",
  "published_at": "2026-07-27T00:00:00.000Z",
  "commit": "container-smoke",
  "short": "container"
}
EOF

"$CONTAINER_ENGINE" run --rm -i \
  --platform "linux/$arch" \
  -v "$tmpdir:/fixture:ro" \
  "$IMAGE" \
  bash -s <<'EOF'
set -Eeuo pipefail

if command -v apt-get >/dev/null 2>&1; then
  apt-get update
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    curl openssh-client
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y curl openssh-clients
elif command -v microdnf >/dev/null 2>&1; then
  microdnf install -y curl openssh-clients
else
  echo "Unsupported package manager in container" >&2
  exit 1
fi

COCALC_CLI_BASE_URL="file:///fixture/software" bash /fixture/install.sh
command -v cocalc
command -v ssh
command -v ssh-keygen
cocalc --version

runtime_root="/root/.local/share/cocalc/current"
test -x "$runtime_root/cocalc"
test -f "$runtime_root/lib/libatomic.so.1"
LD_LIBRARY_PATH="$runtime_root/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
  "$runtime_root/cocalc" --version

echo "CoCalc CLI container smoke test passed."
EOF
