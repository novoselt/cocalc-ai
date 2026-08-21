/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { AppSpec } from "@cocalc/conat/project/api/apps";

export const BLIT_APP_ID = "cocalc-blit-x11";
export const BLIT_PASSPHRASE = "cocalc-private-project";

const START_SCRIPT = String.raw`set -euo pipefail

# Blit and xwayland-satellite are normally installed per-user. Blit discovers
# the satellite when its compositor starts, so this must precede server start.
export PATH="$HOME/.local/bin:$PATH"

if command -v blit >/dev/null 2>&1; then
  blit_bin="$(command -v blit)"
elif [ -x "$HOME/.local/bin/blit" ]; then
  blit_bin="$HOME/.local/bin/blit"
else
  echo "Blit is not installed. Install it from https://blit.sh first." >&2
  exit 127
fi

state_dir="$HOME/.local/state/cocalc/blit"
runtime_dir="$state_dir/runtime"
mkdir -p "$runtime_dir"
chmod 700 "$runtime_dir"

export XDG_RUNTIME_DIR="$runtime_dir"
export BLIT_SOCK="$runtime_dir/server.sock"
export BLIT_REMOTES="$state_dir/remotes"
export BLIT_SERVER_NAME=cocalc-x11
export BLIT_ADDR="$HOST:$PORT"
export BLIT_PROXY=0
export BLIT_XWAYLAND=1

# Stock CoCalc images include Chromium's SwiftShader but may not include a
# system Vulkan ICD. Blit currently needs a Vulkan compositor even when video
# encoding is done in software.
if ! compgen -G "/usr/share/vulkan/icd.d/*.json" >/dev/null &&
   ! compgen -G "/etc/vulkan/icd.d/*.json" >/dev/null; then
  for icd in \
    /usr/lib/chromium/vk_swiftshader_icd.json \
    /usr/lib/chromium-browser/vk_swiftshader_icd.json; do
    if [ -f "$icd" ]; then
      export VK_DRIVER_FILES="$icd"
      export VK_ICD_FILENAMES="$icd"
      break
    fi
  done
fi

printf 'local = socket:%s\n' "$BLIT_SOCK" > "$BLIT_REMOTES"

server_pid=""
gateway_pid=""
cleanup() {
  trap - EXIT INT TERM
  [ -z "$gateway_pid" ] || kill "$gateway_pid" 2>/dev/null || true
  [ -z "$server_pid" ] || kill "$server_pid" 2>/dev/null || true
  [ -z "$gateway_pid" ] || wait "$gateway_pid" 2>/dev/null || true
  [ -z "$server_pid" ] || wait "$server_pid" 2>/dev/null || true
  rm -f "$BLIT_SOCK"
}
trap cleanup EXIT INT TERM

rm -f "$BLIT_SOCK"
"$blit_bin" server \
  --export-sock \
  --inject-path \
  --verbose \
  --max-ptys 16 \
  --no-extensions \
  --no-channels &
server_pid=$!

for _ in $(seq 1 100); do
  [ -S "$BLIT_SOCK" ] && break
  kill -0 "$server_pid" 2>/dev/null || wait "$server_pid"
  sleep 0.1
done
[ -S "$BLIT_SOCK" ] || { echo "Blit server socket did not appear." >&2; exit 1; }

# The stock browser shortcut does not reliably create a terminal when Blit is
# reached through a gateway remote. Seed one so a new .x11 editor is usable.
"$blit_bin" terminal start >/dev/null

"$blit_bin" gateway &
gateway_pid=$!

# A managed app should stop if either half fails; leaving a healthy-looking
# gateway in front of a dead compositor is especially confusing.
set +e
wait -n "$server_pid" "$gateway_pid"
status=$?
set -e
exit "$status"`;

export function createBlitAppSpec(): AppSpec {
  return {
    version: 1,
    id: BLIT_APP_ID,
    title: "Graphical applications (Blit prototype)",
    kind: "service",
    command: {
      exec: "bash",
      args: ["-lc", START_SCRIPT],
      env: {
        BLIT_PASSPHRASE,
      },
    },
    lifecycle: {
      mode: "managed",
    },
    network: {
      listen_host: "127.0.0.1",
      protocol: "http",
    },
    proxy: {
      base_path: `/apps/${BLIT_APP_ID}`,
      strip_prefix: true,
      websocket: true,
      // Blit resolves workers and sockets relative to the document URL, so
      // CoCalc must strip its route prefix before forwarding each subrequest.
      open_mode: "proxy",
      health_path: "/",
      readiness_timeout_s: 30,
    },
    wake: {
      enabled: true,
      keep_warm_s: 15 * 60,
      startup_timeout_s: 45,
    },
  };
}

export function addBlitPassphrase(url: string): string {
  return `${url.split("#", 1)[0]}#psk=${encodeURIComponent(BLIT_PASSPHRASE)}`;
}

export const INSTALL_BLIT_COMMAND =
  "curl -fsSL https://install.blit.sh | BLIT_PREFIX=$HOME/.local sh";
