#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PUBLISH="${SCRIPT_DIR}/multiarch.sh"
TMP="$(mktemp -d)"

cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT

fail() {
  printf 'FAIL: %s\n' "$*" >&2
  exit 1
}

make_artifact() {
  local arch="$1"
  local release_id="$2"
  local dirty="${3:-false}"
  local root="${TMP}/${release_id}-${arch}"
  mkdir -p \
    "$root/runtime/src/packages/project/build" \
    "$root/outer/cocalc-star-${release_id}"
  : >"$root/runtime/src/packages/project/build/tools-linux-${arch}.tar.xz"
  tar -czf "$root/outer/cocalc-star-${release_id}/cocalc-star-runtime.tar.gz" \
    -C "$root/runtime" src
  cat >"$root/outer/cocalc-star-${release_id}/release.json" <<EOF
{
  "release_id": "${release_id}",
  "git_revision": "0123456789ab",
  "git_dirty": ${dirty},
  "payload": "cocalc-star-runtime.tar.gz"
}
EOF
  tar -czf "$root/artifact.tar.gz" -C "$root/outer" "cocalc-star-${release_id}"
  printf '%s\n' "$root/artifact.tar.gz"
}

cat >"$TMP/docker" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$FAKE_DOCKER_LOG"
case "${1:-} ${2:-} ${3:-}" in
  "info --format "*) printf 'linux/%s\n' "${FAKE_DOCKER_ARCH:-amd64}" ;;
  "image inspect "*) ;;
  "buildx version "*) printf 'github.com/docker/buildx v0.test\n' ;;
  "buildx imagetools inspect")
    if [[ " $* " == *" --raw "* ]]; then
      cat <<'JSON'
{"schemaVersion":2,"manifests":[
  {"platform":{"os":"linux","architecture":"amd64"}},
  {"platform":{"os":"linux","architecture":"arm64"}}
]}
JSON
    elif [[ " $* " == *" --format "* ]]; then
      arch=amd64
      [[ " $* " == *"-arm64 "* ]] && arch=arm64
      revision=0123456789ab
      [ "$arch" = "arm64" ] && revision="${FAKE_ARM_REVISION:-$revision}"
      printf \
        '{"os":"linux","architecture":"%s","config":{"Labels":{"org.opencontainers.image.version":"%s","org.opencontainers.image.revision":"%s"}}}\n' \
        "$arch" "$FAKE_RELEASE_ID" "$revision"
    fi
    ;;
esac
if [ "${1:-}" = "image" ] && [ "${2:-}" = "inspect" ]; then
  case "${*: -1}" in
    *'.Os'* ) printf 'linux/%s\n' "${FAKE_DOCKER_ARCH:-amd64}" ;;
    *'version'* ) printf '%s\n' "$FAKE_RELEASE_ID" ;;
    *'revision'* ) printf '0123456789ab\n' ;;
  esac
fi
EOF
chmod +x "$TMP/docker"

cat >"$TMP/build-image" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >>"$FAKE_BUILD_LOG"
EOF
chmod +x "$TMP/build-image"

export PATH="$TMP:$PATH"
export DOCKER=docker
export COCALC_STAR_DOCKER_BUILD_IMAGE_SCRIPT="$TMP/build-image"
export FAKE_DOCKER_LOG="$TMP/docker.log"
export FAKE_BUILD_LOG="$TMP/build.log"
export FAKE_RELEASE_ID="test-release"

amd64_artifact="$(make_artifact amd64 "$FAKE_RELEASE_ID")"
"$PUBLISH" validate \
  --release-artifact "$amd64_artifact" \
  --release-id "$FAKE_RELEASE_ID" |
  rg -q '^platform=linux/amd64$' ||
  fail "standalone artifact validation did not identify linux/amd64"
FAKE_DOCKER_ARCH=amd64 "$PUBLISH" build \
  --release-artifact "$amd64_artifact" \
  --repository example/star \
  --skip-rootfs-cache \
  --push
rg -q "example/star:${FAKE_RELEASE_ID}-amd64" "$FAKE_BUILD_LOG" ||
  fail "amd64 child tag was not passed to the image builder"
rg -q "push example/star:${FAKE_RELEASE_ID}-amd64" "$FAKE_DOCKER_LOG" ||
  fail "verified amd64 child image was not pushed"

COCALC_STAR_DOCKER_CONTEXT_ROOT="$TMP/contexts" \
  COCALC_STAR_DOCKER_RELEASE_ID="$FAKE_RELEASE_ID" \
  COCALC_STAR_DOCKER_GIT_REVISION="0123456789ab" \
  COCALC_STAR_DOCKER_TARGETARCH="amd64" \
  "$SCRIPT_DIR/build-image.sh" \
  --docker docker \
  --tag "example/star:${FAKE_RELEASE_ID}-labels" \
  --release-artifact "$amd64_artifact" \
  --skip-rootfs-cache
rg -q -- "--build-arg COCALC_STAR_RELEASE_ID=${FAKE_RELEASE_ID}" "$FAKE_DOCKER_LOG" ||
  fail "release OCI label build argument was not passed"
rg -q -- "--build-arg COCALC_STAR_GIT_REVISION=0123456789ab" "$FAKE_DOCKER_LOG" ||
  fail "revision OCI label build argument was not passed"
rg -q -- "--build-arg COCALC_STAR_TARGETARCH=amd64" "$FAKE_DOCKER_LOG" ||
  fail "architecture OCI label build argument was not passed"

arm64_artifact="$(make_artifact arm64 "$FAKE_RELEASE_ID")"
if FAKE_DOCKER_ARCH=amd64 "$PUBLISH" build \
  --release-artifact "$arm64_artifact" \
  --repository example/star >"$TMP/mismatch.log" 2>&1; then
  fail "cross-architecture build was accepted"
fi
rg -q "build natively" "$TMP/mismatch.log" ||
  fail "cross-architecture failure did not explain native build requirement"

dirty_artifact="$(make_artifact amd64 dirty-release true)"
if FAKE_DOCKER_ARCH=amd64 "$PUBLISH" build \
  --release-artifact "$dirty_artifact" \
  --repository example/star >"$TMP/dirty.log" 2>&1; then
  fail "dirty release artifact was accepted"
fi
rg -q "refusing to publish an artifact with git_dirty=true" "$TMP/dirty.log" ||
  fail "dirty artifact failure was not explicit"

"$PUBLISH" index \
  --release-id "$FAKE_RELEASE_ID" \
  --repository example/star
rg -q \
  "buildx imagetools create --tag example/star:${FAKE_RELEASE_ID} example/star:${FAKE_RELEASE_ID}-amd64 example/star:${FAKE_RELEASE_ID}-arm64" \
  "$FAKE_DOCKER_LOG" ||
  fail "multi-platform index did not reference both immutable child tags"

if FAKE_ARM_REVISION=ffffffffffff "$PUBLISH" index \
  --release-id "$FAKE_RELEASE_ID" \
  --repository example/star >"$TMP/revision.log" 2>&1; then
  fail "child images with different Git revisions were accepted"
fi
rg -q "child images have different Git revisions" "$TMP/revision.log" ||
  fail "revision mismatch failure was not explicit"

if "$PUBLISH" promote \
  --release-id "$FAKE_RELEASE_ID" \
  --repository example/star >"$TMP/promote.log" 2>&1; then
  fail "latest promotion succeeded without --yes"
fi
rg -q "pass --yes" "$TMP/promote.log" ||
  fail "latest promotion failure did not request confirmation"

printf 'publish-multiarch tests passed\n'
