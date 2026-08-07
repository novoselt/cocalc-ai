#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TMP_ROOT"' EXIT

export COCALC_BAY_ENV_FILE="${TMP_ROOT}/missing-bay.env"
export COCALC_BAY_WORKERS_ENV_FILE="${TMP_ROOT}/missing-workers.env"
export COCALC_BAY_OVERLAY_ENV_FILE="${TMP_ROOT}/missing-overlay.env"
export COCALC_BAY_TOPOLOGY_ENV_FILE="${TMP_ROOT}/missing-topology.env"
export COCALC_BAY_SECRETS_ENV_FILE="${TMP_ROOT}/missing-secrets.env"
export COCALC_BAY_LOCAL_ENV_FILE="${TMP_ROOT}/missing-local.env"
export COCALC_BAY_ID=test-bay
export COCALC_BAY_ROOT="${TMP_ROOT}/bay"
export COCALC_BACKUP_ROOT="${TMP_ROOT}/canonical-backup"
export COCALC_BAY_BACKUP_DIR="${TMP_ROOT}/obsolete-alias"
export COCALC_BAY_PGBACKREST_SPOOL_PATH="${COCALC_BAY_ROOT}/backups/pgbackrest/spool"
export COCALC_BAY_SQLITE_MIRROR_DIR="${COCALC_BAY_ROOT}/backups/sqlite-mirror/sync"

# shellcheck source=lib.sh
source "${SCRIPT_DIR}/lib.sh"

[[ "$COCALC_BAY_BACKUP_DIR" == "$COCALC_BACKUP_ROOT" ]]
[[ "$COCALC_BAY_PGBACKREST_SPOOL_PATH" == "$COCALC_BACKUP_ROOT/pgbackrest/spool" ]]
[[ "$COCALC_BAY_SQLITE_MIRROR_DIR" == "$COCALC_BACKUP_ROOT/sqlite-mirror/sync" ]]

COCALC_BAY_BACKUP_REQUIRE_SEPARATE_FILESYSTEM=0
assert_backup_storage_ready
[[ -d "$COCALC_BACKUP_ROOT" ]]

COCALC_BAY_BACKUP_REQUIRE_SEPARATE_FILESYSTEM=1
if assert_backup_storage_ready 2>/dev/null; then
  echo "same-filesystem backup root unexpectedly passed strict validation" >&2
  exit 1
fi

missing="${TMP_ROOT}/missing-mount"
COCALC_BACKUP_ROOT="$missing"
COCALC_BAY_BACKUP_DIR="$missing"
if assert_backup_storage_ready 2>/dev/null; then
  echo "missing strict backup mount unexpectedly passed validation" >&2
  exit 1
fi
[[ ! -e "$missing" ]]

disabled_status_root="${TMP_ROOT}/disabled-status-root"
COCALC_BACKUP_ROOT="$disabled_status_root" \
COCALC_BAY_BACKUP_DIR="$disabled_status_root" \
COCALC_BAY_PGBACKREST_ENABLED=0 \
  bash "${SCRIPT_DIR}/bay-pgbackrest-status" >/dev/null
[[ ! -e "$disabled_status_root" ]]

strict_status_root="${TMP_ROOT}/strict-status-root"
if COCALC_BACKUP_ROOT="$strict_status_root" \
  COCALC_BAY_BACKUP_DIR="$strict_status_root" \
  COCALC_BAY_BACKUP_REQUIRE_SEPARATE_FILESYSTEM=1 \
  COCALC_BAY_PGBACKREST_ENABLED=1 \
    bash "${SCRIPT_DIR}/bay-pgbackrest-status" >/dev/null 2>&1; then
  echo "pgBackRest status unexpectedly accepted a missing strict mount" >&2
  exit 1
fi
[[ ! -e "$strict_status_root" ]]

(
  export COCALC_BAY_PGBACKREST_SPOOL_PATH="${TMP_ROOT}/conflicting/spool"
  # shellcheck source=lib.sh
  source "${SCRIPT_DIR}/lib.sh"
  COCALC_BAY_BACKUP_REQUIRE_SEPARATE_FILESYSTEM=0
  if assert_backup_storage_ready 2>/dev/null; then
    echo "conflicting backup child path unexpectedly passed validation" >&2
    exit 1
  fi
)

check_root="${TMP_ROOT}/operator-check"
COCALC_BACKUP_ROOT="$check_root" \
COCALC_BAY_BACKUP_REQUIRE_SEPARATE_FILESYSTEM=0 \
COCALC_BAY_PGBACKREST_SPOOL_PATH="$check_root/pgbackrest/spool" \
COCALC_BAY_SQLITE_MIRROR_DIR="$check_root/sqlite-mirror/sync" \
  bash "${SCRIPT_DIR}/bay-backup-storage-check" >/dev/null
[[ -d "$check_root" ]]

echo "bay backup storage validation tests passed"
