#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <cocalc-binary> <output.tar.gz>" >&2
  exit 2
fi

BINARY="$1"
OUTPUT="$2"

if [[ ! -x "$BINARY" ]]; then
  echo "CoCalc CLI binary is not executable: $BINARY" >&2
  exit 1
fi

for command in tar gzip; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required command for Linux CLI packaging: $command" >&2
    exit 1
  fi
done

LIBATOMIC="${COCALC_CLI_LIBATOMIC_PATH:-}"
if [[ -z "$LIBATOMIC" ]]; then
  if ! command -v ldd >/dev/null 2>&1; then
    echo "Missing required command for Linux CLI packaging: ldd" >&2
    exit 1
  fi
  LIBATOMIC="$(
    ldd "$BINARY" |
      awk '$1 == "libatomic.so.1" && $2 == "=>" && $3 ~ /^\// { print $3; exit }'
  )"
fi
if [[ -z "$LIBATOMIC" || ! -f "$LIBATOMIC" ]]; then
  echo "Unable to resolve libatomic.so.1 for $BINARY" >&2
  exit 1
fi

tmpdir="$(mktemp -d)"
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

mkdir -p "$tmpdir/lib" "$(dirname "$OUTPUT")"
cp "$BINARY" "$tmpdir/cocalc"
cp -L "$LIBATOMIC" "$tmpdir/lib/libatomic.so.1"
chmod 0755 "$tmpdir/cocalc"
chmod 0644 "$tmpdir/lib/libatomic.so.1"

tar \
  --sort=name \
  --owner=0 \
  --group=0 \
  --numeric-owner \
  --mtime="@0" \
  -czf "$OUTPUT" \
  -C "$tmpdir" \
  cocalc lib/libatomic.so.1

archive_files="$(tar -tzf "$OUTPUT")"
if [[ "$archive_files" != $'cocalc\nlib/libatomic.so.1' ]]; then
  echo "Unexpected Linux CLI runtime bundle contents:" >&2
  echo "$archive_files" >&2
  exit 1
fi

echo "Built Linux CLI runtime bundle: $OUTPUT"
