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

TMP_RCLONE="$(mktemp -d)"
trap 'rm -rf "$TMP_RCLONE"' EXIT
curl -fsSL https://downloads.rclone.org/rclone-current-linux-amd64.zip \
  -o "$TMP_RCLONE/rclone-current-linux-amd64.zip"
python3 - "$TMP_RCLONE" <<'PY'
import pathlib
import shutil
import sys
import zipfile

tmp = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(tmp / "rclone-current-linux-amd64.zip") as z:
    z.extractall(tmp / "extract")
for path in (tmp / "extract").glob("rclone-*-linux-amd64/rclone"):
    shutil.copy2(path, tmp / "rclone")
    break
else:
    raise SystemExit("rclone binary not found in archive")
PY
$SUDO install -m 0755 "$TMP_RCLONE/rclone" /usr/local/bin/rclone

echo "archive-to-r2 VM setup complete"
echo "Check tools:"
echo "  bup:    $(command -v bup || true)"
echo "  gcloud: $(command -v gcloud || true)"
echo "  rclone: $(command -v rclone || true)"
echo "  zfs:    $(command -v zfs || true)"
