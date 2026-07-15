#!/usr/bin/env bash

# Run ncc with enough heap for production bundles. Callers may still provide an
# explicit old-space limit through NODE_OPTIONS when a different limit is needed.

set -euo pipefail

case " ${NODE_OPTIONS:-} " in
  *" --max-old-space-size="* | *" --max_old_space_size="* | *" --max-old-space-size "* | *" --max_old_space_size "*) ;;
  *) export NODE_OPTIONS="${NODE_OPTIONS:+${NODE_OPTIONS} }--max-old-space-size=8192" ;;
esac

if [[ $# -gt 0 && -x "$1" ]]; then
  ncc_bin="$1"
  shift
else
  ncc_bin="$(command -v ncc || true)"
  if [[ -z "$ncc_bin" ]]; then
    script_root="$(realpath "$(dirname "$0")/..")"
    for candidate in \
      "$script_root/packages/rocket/node_modules/.bin/ncc" \
      "$script_root/packages/node_modules/.pnpm/node_modules/.bin/ncc"; do
      if [[ -x "$candidate" ]]; then
        ncc_bin="$candidate"
        break
      fi
    done
  fi
fi

if [[ -z "$ncc_bin" || ! -x "$ncc_bin" ]]; then
  echo "ERROR: ncc binary not found" >&2
  exit 1
fi

exec "$ncc_bin" "$@"
