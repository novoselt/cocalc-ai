#!/usr/bin/env bash
set -euo pipefail

# Bootstrap an Ubuntu/Debian GCE VM for src/scripts/legacy-migration/archive_to_r2.py.
# Run as root or a sudo-capable user.

if [[ "${EUID}" -ne 0 ]]; then
  SUDO=sudo
else
  SUDO=
fi

$SUDO apt-get update
$SUDO apt-get install -y \
  bup \
  ca-certificates \
  curl \
  gnupg \
  lz4 \
  python3 \
  python3-venv \
  rclone \
  tmux \
  zfsutils-linux \
  zstd

if ! command -v gcloud >/dev/null 2>&1; then
  $SUDO install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://packages.cloud.google.com/apt/doc/apt-key.gpg \
    | $SUDO gpg --dearmor -o /etc/apt/keyrings/google-cloud-cli.gpg
  echo "deb [signed-by=/etc/apt/keyrings/google-cloud-cli.gpg] https://packages.cloud.google.com/apt cloud-sdk main" \
    | $SUDO tee /etc/apt/sources.list.d/google-cloud-sdk.list >/dev/null
  $SUDO apt-get update
  $SUDO apt-get install -y google-cloud-cli
fi

$SUDO modprobe zfs || true

echo "archive-to-r2 VM setup complete"
echo "Check tools:"
echo "  bup:    $(command -v bup || true)"
echo "  gcloud: $(command -v gcloud || true)"
echo "  rclone: $(command -v rclone || true)"
echo "  zfs:    $(command -v zfs || true)"
