#!/usr/bin/env bash
set -euo pipefail

exec "${COCALC_SEA_NODE_BIN:-node}" "$(dirname "$0")/build-sea.mjs" "$@"
