#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUILD_IMAGE="${COCALC_STAR_DOCKER_BUILD_IMAGE_SCRIPT:-${SCRIPT_DIR}/build-image.sh}"
REPOSITORY="${COCALC_STAR_DOCKER_REPOSITORY:-sagemathinc/star}"
DOCKER="${DOCKER:-docker}"

log() {
  printf '[star-docker-publish] %s\n' "$*" >&2
}

die() {
  log "ERROR: $*"
  exit 1
}

usage() {
  cat <<'EOF'
Usage:
  multiarch.sh validate --release-artifact <tgz> [options]
  multiarch.sh build --release-artifact <tgz> [options]
  multiarch.sh index --release-id <id> [options]
  multiarch.sh inspect --release-id <id> [options]
  multiarch.sh promote --release-id <id> --yes [options]

Build and publish native CoCalc Star Docker images without emulation.

Commands:
  validate  verify release metadata and the embedded project-tools architecture
            without requiring Docker
  build     validate a native runtime artifact and build the immutable
            <release-id>-amd64 or <release-id>-arm64 child image
  index     publish <release-id> as a two-platform OCI image index after both
            immutable child images have been pushed
  inspect   verify that the release image index has exactly linux/amd64 and
            linux/arm64 images
  promote   point latest at an already-verified release image index; requires
            --yes and is intentionally separate from build/index

Common options:
  --repository <name>      registry repository (default: sagemathinc/star)
  --release-id <id>        expected release id
  --docker <command>       Docker CLI (default: docker; may be "sudo docker")
  -h, --help               show this help

Build options:
  --release-artifact <tgz> native cocalc-star runtime release artifact
  --arch <arch>            amd64/x86_64/x64 or arm64/aarch64; defaults to the
                           Docker engine architecture
  --push                   push the immutable child tag after local validation
  --rootfs-cache <tgz>     forward an existing RootFS cache to build-image.sh
  --skip-rootfs-cache      do not embed the default RootFS cache
  --cache-btrfs-size <n>   forward the RootFS cache image size
  --keep-context           retain the Docker build context

Examples:
  multiarch.sh validate \
    --release-artifact cocalc-star-runtime-linux-x64.tar.gz
  multiarch.sh build \
    --release-artifact cocalc-star-runtime-linux-x64.tar.gz --push
  multiarch.sh build \
    --release-artifact cocalc-star-runtime-linux-arm64.tar.gz --push
  multiarch.sh index --release-id 20260729T191811Z-fe6287a6bc3a
  multiarch.sh inspect --release-id 20260729T191811Z-fe6287a6bc3a

No command updates latest except the explicit promote command.
EOF
}

normalize_arch() {
  case "$1" in
    amd64 | x86_64 | x64) printf 'amd64\n' ;;
    arm64 | aarch64) printf 'arm64\n' ;;
    *) die "unsupported architecture: $1" ;;
  esac
}

validate_component() {
  local kind="$1"
  local value="$2"
  case "$value" in
    "" | *[!A-Za-z0-9._-]*) die "invalid ${kind}: ${value}" ;;
  esac
}

DOCKER_CMD=()
docker_cli() {
  "${DOCKER_CMD[@]}" "$@"
}

init_docker() {
  read -r -a DOCKER_CMD <<<"$DOCKER"
  [ "${#DOCKER_CMD[@]}" -gt 0 ] || die "empty Docker CLI command"
  command -v "${DOCKER_CMD[0]}" >/dev/null 2>&1 ||
    die "missing Docker CLI: ${DOCKER_CMD[0]}"
}

require_buildx() {
  docker_cli buildx version >/dev/null 2>&1 ||
    die "Docker buildx is required to inspect and create multi-platform image indexes"
}

ARTIFACT_RELEASE_ID=""
ARTIFACT_GIT_REVISION=""
ARTIFACT_GIT_DIRTY=""
ARTIFACT_PAYLOAD=""
ARTIFACT_ARCH=""

read_artifact_metadata() {
  local artifact="$1"
  local top metadata tools_entries
  command -v node >/dev/null 2>&1 || die "node is required"
  command -v tar >/dev/null 2>&1 || die "tar is required"
  [ -f "$artifact" ] || die "release artifact does not exist: $artifact"

  top="$(tar -tzf "$artifact" | sed -n '1{s|/.*||;p;}')"
  [ -n "$top" ] || die "unable to determine release artifact root"
  metadata="$(tar -xOzf "$artifact" "${top}/release.json")" ||
    die "release artifact is missing release.json"

  IFS=$'\t' read -r \
    ARTIFACT_RELEASE_ID \
    ARTIFACT_GIT_REVISION \
    ARTIFACT_GIT_DIRTY \
    ARTIFACT_PAYLOAD <<EOF
$(printf '%s' "$metadata" | node -e '
  const fs = require("fs");
  const value = JSON.parse(fs.readFileSync(0, "utf8"));
  const fields = [
    value.release_id ?? "",
    value.git_revision ?? "",
    String(value.git_dirty ?? ""),
    value.payload ?? "",
  ];
  if (fields.some((field) => field.includes("\t") || field.includes("\n"))) {
    throw new Error("invalid control character in release metadata");
  }
  process.stdout.write(fields.join("\t"));
')
EOF

  validate_component "artifact release id" "$ARTIFACT_RELEASE_ID"
  validate_component "artifact git revision" "$ARTIFACT_GIT_REVISION"
  [ "$ARTIFACT_GIT_DIRTY" = "false" ] ||
    die "refusing to publish an artifact with git_dirty=${ARTIFACT_GIT_DIRTY}"
  [ "$ARTIFACT_PAYLOAD" = "cocalc-star-runtime.tar.gz" ] ||
    die "expected a runtime release artifact, got payload=${ARTIFACT_PAYLOAD}"

  tools_entries="$(
    tar -xOzf "$artifact" "${top}/${ARTIFACT_PAYLOAD}" |
      tar -tzf - |
      sed -n 's#.*/tools-linux-\(amd64\|arm64\)\.tar\.xz$#\1#p'
  )"
  case "$tools_entries" in
    amd64 | arm64) ARTIFACT_ARCH="$tools_entries" ;;
    "") die "runtime artifact has no architecture-specific project tools bundle" ;;
    *) die "runtime artifact has multiple project tools architectures: ${tools_entries//$'\n'/,}" ;;
  esac
}

verify_local_image() {
  local image="$1"
  local expected_arch="$2"
  local expected_release="$3"
  local expected_revision="$4"
  local platform release revision
  platform="$(docker_cli image inspect "$image" --format '{{.Os}}/{{.Architecture}}')"
  release="$(
    docker_cli image inspect "$image" \
      --format '{{index .Config.Labels "org.opencontainers.image.version"}}'
  )"
  revision="$(
    docker_cli image inspect "$image" \
      --format '{{index .Config.Labels "org.opencontainers.image.revision"}}'
  )"
  [ "$platform" = "linux/${expected_arch}" ] ||
    die "built image platform is ${platform}, expected linux/${expected_arch}"
  [ "$release" = "$expected_release" ] ||
    die "built image release label is ${release}, expected ${expected_release}"
  [ "$revision" = "$expected_revision" ] ||
    die "built image revision label is ${revision}, expected ${expected_revision}"
}

verify_remote_child() {
  local image="$1"
  local expected_arch="$2"
  local expected_release="$3"
  local raw
  raw="$(
    docker_cli buildx imagetools inspect "$image" --format '{{json .Image}}'
  )" || die "unable to inspect child image ${image}"
  printf '%s' "$raw" | node -e '
const fs = require("fs");
const [image, expectedArch, expectedRelease] = process.argv.slice(1);
const value = JSON.parse(fs.readFileSync(0, "utf8"));
const platform = `${value.os ?? ""}/${value.architecture ?? ""}`;
const labels = value.config?.Labels ?? value.config?.labels ?? {};
if (platform !== `linux/${expectedArch}`) {
  throw new Error(`${image} platform is ${platform}; expected linux/${expectedArch}`);
}
if (labels["org.opencontainers.image.version"] !== expectedRelease) {
  throw new Error(`${image} has the wrong release label`);
}
const revision = labels["org.opencontainers.image.revision"];
if (!revision) {
  throw new Error(`${image} has no Git revision label`);
}
process.stdout.write(revision);
' "$image" "$expected_arch" "$expected_release"
}

verify_remote_index() {
  local image="$1"
  local raw
  raw="$(docker_cli buildx imagetools inspect --raw "$image")" ||
    die "unable to inspect ${image}"
  printf '%s' "$raw" | node -e '
const fs = require("fs");
const image = process.argv[1];
const value = JSON.parse(fs.readFileSync(0, "utf8"));
if (!Array.isArray(value.manifests)) {
  throw new Error(`${image} is not a multi-platform image index`);
}
const actual = value.manifests
  .map(({ platform }) => `${platform?.os ?? ""}/${platform?.architecture ?? ""}`)
  .sort();
const expected = ["linux/amd64", "linux/arm64"];
if (JSON.stringify(actual) !== JSON.stringify(expected)) {
  throw new Error(
    `${image} platforms are ${actual.join(", ") || "empty"}; expected ${expected.join(", ")}`,
  );
}
process.stdout.write(`${image}: ${actual.join(", ")}\n`);
' "$image"
}

prepare_artifact() {
  [ -n "$RELEASE_ARTIFACT" ] || die "$COMMAND requires --release-artifact"
  read_artifact_metadata "$RELEASE_ARTIFACT"
  if [ -n "$RELEASE_ID" ] && [ "$RELEASE_ID" != "$ARTIFACT_RELEASE_ID" ]; then
    die "artifact release id ${ARTIFACT_RELEASE_ID} does not match ${RELEASE_ID}"
  fi
  RELEASE_ID="$ARTIFACT_RELEASE_ID"
  if [ -n "$REQUESTED_ARCH" ] && [ "$REQUESTED_ARCH" != "$ARTIFACT_ARCH" ]; then
    die "artifact architecture ${ARTIFACT_ARCH} does not match ${REQUESTED_ARCH}"
  fi
  REQUESTED_ARCH="$ARTIFACT_ARCH"
  validate_component "release id" "$RELEASE_ID"
}

COMMAND="${1:-}"
case "$COMMAND" in
  validate | build | index | inspect | promote) shift ;;
  -h | --help | "") usage; exit 0 ;;
  *) die "unknown command: $COMMAND" ;;
esac

RELEASE_ID=""
RELEASE_ARTIFACT=""
REQUESTED_ARCH=""
PUSH=0
CONFIRM=0
BUILD_ARGS=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repository)
      REPOSITORY="$2"
      shift 2
      ;;
    --release-id)
      RELEASE_ID="$2"
      shift 2
      ;;
    --docker)
      DOCKER="$2"
      shift 2
      ;;
    --release-artifact)
      [[ "$COMMAND" = "validate" || "$COMMAND" = "build" ]] ||
        die "--release-artifact is only valid for validate/build"
      RELEASE_ARTIFACT="$2"
      shift 2
      ;;
    --arch)
      [[ "$COMMAND" = "validate" || "$COMMAND" = "build" ]] ||
        die "--arch is only valid for validate/build"
      REQUESTED_ARCH="$(normalize_arch "$2")"
      shift 2
      ;;
    --push)
      [ "$COMMAND" = "build" ] || die "--push is only valid for build"
      PUSH=1
      shift
      ;;
    --rootfs-cache | --cache-btrfs-size)
      [ "$COMMAND" = "build" ] || die "$1 is only valid for build"
      BUILD_ARGS+=("$1" "$2")
      shift 2
      ;;
    --skip-rootfs-cache | --keep-context)
      [ "$COMMAND" = "build" ] || die "$1 is only valid for build"
      BUILD_ARGS+=("$1")
      shift
      ;;
    --yes)
      [ "$COMMAND" = "promote" ] || die "--yes is only valid for promote"
      CONFIRM=1
      shift
      ;;
    -h | --help)
      usage
      exit 0
      ;;
    *)
      die "unknown argument: $1"
      ;;
  esac
done

case "$REPOSITORY" in
  "" | *[[:space:]]*) die "invalid repository: $REPOSITORY" ;;
esac

case "$COMMAND" in
  validate)
    prepare_artifact
    cat <<EOF
release_id=${RELEASE_ID}
git_revision=${ARTIFACT_GIT_REVISION}
platform=linux/${REQUESTED_ARCH}
git_dirty=${ARTIFACT_GIT_DIRTY}
EOF
    ;;
  build)
    prepare_artifact
    init_docker

    engine_platform="$(docker_cli info --format '{{.OSType}}/{{.Architecture}}')"
    engine_os="${engine_platform%%/*}"
    engine_arch="$(normalize_arch "${engine_platform#*/}")"
    [ "$engine_os" = "linux" ] ||
      die "Docker engine OS is ${engine_os}, expected linux"
    [ "$engine_arch" = "$REQUESTED_ARCH" ] ||
      die "Docker engine architecture is ${engine_arch}, artifact is ${REQUESTED_ARCH}; build natively"

    child_image="${REPOSITORY}:${RELEASE_ID}-${REQUESTED_ARCH}"
    log "building ${child_image} from ${RELEASE_ARTIFACT}"
    COCALC_STAR_DOCKER_RELEASE_ID="$RELEASE_ID" \
      COCALC_STAR_DOCKER_GIT_REVISION="$ARTIFACT_GIT_REVISION" \
      COCALC_STAR_DOCKER_TARGETARCH="$REQUESTED_ARCH" \
      "$BUILD_IMAGE" \
      --docker "$DOCKER" \
      --tag "$child_image" \
      --release-artifact "$RELEASE_ARTIFACT" \
      "${BUILD_ARGS[@]}"
    verify_local_image \
      "$child_image" "$REQUESTED_ARCH" "$RELEASE_ID" "$ARTIFACT_GIT_REVISION"
    if [ "$PUSH" -eq 1 ]; then
      log "pushing immutable child image ${child_image}"
      docker_cli push "$child_image"
    else
      log "built and verified ${child_image}; add --push to publish it"
    fi
    ;;
  index)
    [ -n "$RELEASE_ID" ] || die "index requires --release-id"
    validate_component "release id" "$RELEASE_ID"
    init_docker
    require_buildx
    amd64_image="${REPOSITORY}:${RELEASE_ID}-amd64"
    arm64_image="${REPOSITORY}:${RELEASE_ID}-arm64"
    release_image="${REPOSITORY}:${RELEASE_ID}"
    amd64_revision="$(verify_remote_child "$amd64_image" amd64 "$RELEASE_ID")"
    arm64_revision="$(verify_remote_child "$arm64_image" arm64 "$RELEASE_ID")"
    [ "$amd64_revision" = "$arm64_revision" ] ||
      die "child images have different Git revisions: amd64=${amd64_revision}, arm64=${arm64_revision}"
    log "publishing multi-platform image index ${release_image}"
    docker_cli buildx imagetools create \
      --tag "$release_image" \
      "$amd64_image" \
      "$arm64_image"
    verify_remote_index "$release_image"
    ;;
  inspect)
    [ -n "$RELEASE_ID" ] || die "inspect requires --release-id"
    validate_component "release id" "$RELEASE_ID"
    init_docker
    require_buildx
    verify_remote_index "${REPOSITORY}:${RELEASE_ID}"
    ;;
  promote)
    [ -n "$RELEASE_ID" ] || die "promote requires --release-id"
    validate_component "release id" "$RELEASE_ID"
    [ "$CONFIRM" -eq 1 ] ||
      die "promote updates ${REPOSITORY}:latest; pass --yes after testing the release"
    init_docker
    require_buildx
    release_image="${REPOSITORY}:${RELEASE_ID}"
    verify_remote_index "$release_image"
    log "promoting ${release_image} to ${REPOSITORY}:latest"
    docker_cli buildx imagetools create \
      --tag "${REPOSITORY}:latest" \
      "$release_image"
    verify_remote_index "${REPOSITORY}:latest"
    ;;
esac
