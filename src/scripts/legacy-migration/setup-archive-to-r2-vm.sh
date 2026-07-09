#!/usr/bin/env bash
set -euo pipefail

# Bootstrap an Ubuntu/Debian GCE VM for src/scripts/legacy-migration/archive_to_r2.py.
# Run as root or a sudo-capable user.

if [[ "${EUID}" -ne 0 ]]; then
  SUDO=sudo
else
  SUDO=
fi
GCS_KEY_FILE="${1:-}"

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

if [[ -n "$GCS_KEY_FILE" ]]; then
  if ! $SUDO gcloud auth activate-service-account --key-file="$GCS_KEY_FILE"; then
    NORMALIZED_KEY="$(mktemp)"
    python3 - "$GCS_KEY_FILE" "$NORMALIZED_KEY" <<'PY'
import json
import re
import sys
import textwrap

src, dst = sys.argv[1], sys.argv[2]
raw = open(src, encoding="utf-8").read()


def find_string(key, default=""):
    m = re.search(r'"' + re.escape(key) + r'"\s*:\s*"([^"\n\r]*)"', raw)
    if not m:
        if default != "":
            return default
        raise SystemExit(f"missing {key}")
    return m.group(1)


m = re.search(r'"private_key"\s*:\s*"(.*?)"\s*,\s*"client_email"', raw, re.S)
if not m:
    raise SystemExit("missing private_key")
private_key = re.sub(r"\\\s*n", "\n", m.group(1))
private_key = private_key.replace("\\n", "\n")
lines = private_key.splitlines()
if lines and lines[0].startswith("-----BEGIN"):
    body = "".join(lines[1:-1])
    allowed = set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=")
    body = "".join(ch for ch in body if ch in allowed)
    private_key = lines[0] + "\n" + "\n".join(textwrap.wrap(body, 64)) + "\n" + lines[-1] + "\n"
elif not private_key.endswith("\n"):
    private_key += "\n"

obj = {
    "type": find_string("type", "service_account"),
    "project_id": find_string("project_id"),
    "private_key_id": find_string("private_key_id", ""),
    "private_key": private_key,
    "client_email": find_string("client_email"),
    "client_id": find_string("client_id", ""),
    "auth_uri": find_string("auth_uri", "https://accounts.google.com/o/oauth2/auth"),
    "token_uri": find_string("token_uri", "https://oauth2.googleapis.com/token"),
    "auth_provider_x509_cert_url": find_string("auth_provider_x509_cert_url", "https://www.googleapis.com/oauth2/v1/certs"),
    "client_x509_cert_url": find_string("client_x509_cert_url", ""),
    "universe_domain": find_string("universe_domain", "googleapis.com"),
}
with open(dst, "w", encoding="utf-8") as f:
    json.dump(obj, f)
PY
    $SUDO gcloud auth activate-service-account --key-file="$NORMALIZED_KEY"
    rm -f "$NORMALIZED_KEY"
  fi
fi

echo "archive-to-r2 VM setup complete"
echo "Check tools:"
echo "  bup:    $(command -v bup || true)"
echo "  gcloud: $(command -v gcloud || true)"
echo "  rclone: $(command -v rclone || true)"
echo "  zfs:    $(command -v zfs || true)"
