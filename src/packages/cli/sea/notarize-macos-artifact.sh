#!/usr/bin/env bash
set -Eeuo pipefail

if [[ $# -ne 2 ]]; then
  echo "Usage: $0 <signed-cocalc-binary> <notary-log.json>" >&2
  exit 2
fi

BINARY="$(realpath "$1")"
NOTARY_LOG="$2"

for name in \
  APPLE_NOTARY_KEY_P8_BASE64 \
  APPLE_NOTARY_KEY_ID \
  APPLE_NOTARY_ISSUER_ID; do
  if [[ -z "${!name:-}" ]]; then
    echo "Missing required notarization credential: $name" >&2
    exit 1
  fi
done

for command in codesign ditto openssl xcrun; do
  if ! command -v "$command" >/dev/null 2>&1; then
    echo "Missing required notarization command: $command" >&2
    exit 1
  fi
done

codesign --verify --strict --verbose=2 "$BINARY"

tmpdir="$(mktemp -d)"
cleanup() { rm -rf "$tmpdir"; }
trap cleanup EXIT

key="$tmpdir/AuthKey.p8"
archive="$tmpdir/cocalc-cli.zip"
result="$tmpdir/notary-result.json"
printf '%s' "$APPLE_NOTARY_KEY_P8_BASE64" |
  openssl base64 -d -A > "$key"
chmod 0600 "$key"
ditto -c -k --keepParent "$BINARY" "$archive"

xcrun notarytool submit "$archive" \
  --key "$key" \
  --key-id "$APPLE_NOTARY_KEY_ID" \
  --issuer "$APPLE_NOTARY_ISSUER_ID" \
  --wait \
  --output-format json > "$result"

submission_id="$(node -e '
  const value = JSON.parse(require("node:fs").readFileSync(process.argv[1], "utf8"));
  if (value.status !== "Accepted" || !value.id) {
    console.error(JSON.stringify(value, null, 2));
    process.exit(1);
  }
  process.stdout.write(value.id);
' "$result")"

mkdir -p "$(dirname "$NOTARY_LOG")"
xcrun notarytool log "$submission_id" \
  --key "$key" \
  --key-id "$APPLE_NOTARY_KEY_ID" \
  --issuer "$APPLE_NOTARY_ISSUER_ID" \
  "$NOTARY_LOG"

# Apple issues online tickets for standalone binaries, but does not support
# stapling those tickets directly to a command-line executable.
echo "Notarized standalone CoCalc CLI binary: submission $submission_id"
echo "Notary log: $NOTARY_LOG"
