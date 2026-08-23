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
export COCALC_BAY_STATE_DIR="${TMP_ROOT}/state"
export COCALC_BAY_RUN_DIR="${TMP_ROOT}/run"
export COCALC_BAY_LOG_DIR="${TMP_ROOT}/log"
export COCALC_BAY_BACKUP_DIR="${TMP_ROOT}/backup"
export COCALC_BAY_SQLITE_BACKUP_ENABLED=1
export COCALC_BAY_SQLITE_SOURCE_DIR="${TMP_ROOT}/source"
export COCALC_BAY_SQLITE_MIRROR_DIR="${TMP_ROOT}/backup/sqlite-mirror/sync"
export COCALC_BAY_SQLITE_MIRROR_CATALOG="${TMP_ROOT}/catalog.json"
export COCALC_BAY_SQLITE_BACKUP_STATUS_FILE="${TMP_ROOT}/status.json"
export COCALC_BAY_SQLITE_RUSTIC_PROFILE="${TMP_ROOT}/rustic.toml"
export COCALC_BAY_SQLITE_BACKUP_LOCK_WAIT_SECONDS=5
export COCALC_BAY_PGBACKREST_S3_BUCKET=test-bucket
export COCALC_BAY_PGBACKREST_S3_ENDPOINT=example.r2.cloudflarestorage.com
export COCALC_BAY_PGBACKREST_S3_ACCESS_KEY=test-access
export COCALC_BAY_PGBACKREST_S3_SECRET_KEY=test-secret
export COCALC_BAY_SQLITE_RUSTIC_PASSWORD=test-password

mkdir -p "$COCALC_BAY_SQLITE_SOURCE_DIR" "${TMP_ROOT}/bin"
touch "${COCALC_BAY_SQLITE_SOURCE_DIR}/stream.db"

cat > "${TMP_ROOT}/bin/node" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '{"scanned_files":1,"current_files":1,"changed_files":["stream.db"],"deleted_files":[],"sqlite_backups":1,"copied_files":0,"catalog_path":"catalog.json"}'
EOF
cat > "${TMP_ROOT}/bin/rustic" <<'EOF'
#!/usr/bin/env bash
if [[ " $* " == *" repoinfo "* ]]; then
  exit 1
fi
if [[ " $* " == *" backup "* ]]; then
  printf '%s\n' '{"type":"summary","id":"snapshot-1","data_added":123}'
fi
EOF
chmod 0755 "${TMP_ROOT}/bin/node" "${TMP_ROOT}/bin/rustic"
export COCALC_BAY_NODE_BIN="${TMP_ROOT}/bin/node"
export COCALC_BAY_SQLITE_MIRROR_ENTRY="${TMP_ROOT}/entry.js"
export COCALC_BAY_SQLITE_RUSTIC_BIN="${TMP_ROOT}/bin/rustic"
touch "$COCALC_BAY_SQLITE_MIRROR_ENTRY"

# The weekly prune and hourly backup share this lock. A timer collision must
# delay the backup rather than silently skipping an entire hourly snapshot.
mkdir -p "$COCALC_BAY_RUN_DIR"
(
  exec 8> "${COCALC_BAY_RUN_DIR}/sqlite-backup.lock"
  flock 8
  touch "${TMP_ROOT}/lock-ready"
  sleep 1
) &
lock_holder_pid=$!
while [[ ! -e "${TMP_ROOT}/lock-ready" ]]; do
  sleep 0.01
done
bash "${SCRIPT_DIR}/bay-sqlite-backup-run" >/dev/null
wait "$lock_holder_pid"
python3 - "$COCALC_BAY_SQLITE_BACKUP_STATUS_FILE" <<'PY'
import json
import sys
with open(sys.argv[1], encoding="utf8") as src:
    status = json.load(src)
assert status["level"] == "ok", status
assert status["mirror"]["sqlite_backups"] == 1, status
assert status["mirror"]["changed_files_count"] == 1, status
assert status["mirror"]["deleted_files_count"] == 0, status
assert "changed_files" not in status["mirror"], status
assert "deleted_files" not in status["mirror"], status
assert status["rustic"]["snapshot_id"] == "snapshot-1", status
assert status["rustic"]["id"] == "snapshot-1", status
PY
grep -qx 'endpoint = "https://example.r2.cloudflarestorage.com"' "$COCALC_BAY_SQLITE_RUSTIC_PROFILE"
grep -q 'test-access' "$COCALC_BAY_SQLITE_RUSTIC_PROFILE"
[[ "$(stat -c '%a' "$COCALC_BAY_SQLITE_RUSTIC_PROFILE")" == 600 ]]

echo "bay changed-only SQLite backup tests passed"
