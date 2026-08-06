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
export COCALC_BAY_ID="test-bay"
export COCALC_BAY_ROOT="${TMP_ROOT}/bay"
export COCALC_BAY_RUN_DIR="${TMP_ROOT}/run"
export COCALC_BAY_BACKUP_DIR="${TMP_ROOT}/backup"
export COCALC_BAY_LOG_DIR="${TMP_ROOT}/log"
export COCALC_BAY_POSTGRES_DATA_DIR="${TMP_ROOT}/postgres"
export COCALC_BAY_POSTGRES_SOCKET_DIR="${TMP_ROOT}/socket"
export COCALC_BAY_POSTGRES_PORT="5432"
export COCALC_BAY_PGBACKREST_ENABLED="1"
export COCALC_BAY_PGBACKREST_CONFIG="${TMP_ROOT}/backup/pgbackrest.conf"
export COCALC_BAY_PGBACKREST_S3_BUCKET="test-bucket"
export COCALC_BAY_PGBACKREST_S3_ENDPOINT="https://example.r2.cloudflarestorage.com/"
export COCALC_BAY_PGBACKREST_S3_ACCESS_KEY="access-key"
export COCALC_BAY_PGBACKREST_S3_SECRET_KEY="secret-key"
export COCALC_BAY_PGBACKREST_CIPHER_PASS="cipher-pass"

bash "${SCRIPT_DIR}/bay-pgbackrest-configure"
config="$COCALC_BAY_PGBACKREST_CONFIG"
[[ "$(stat -c '%a' "$config")" == "600" ]]
grep -qx 'repo1-s3-endpoint=example.r2.cloudflarestorage.com' "$config"
grep -qx 'repo1-block=y' "$config"
grep -qx 'start-fast=n' "$config"
grep -qx "lock-path=${COCALC_BAY_RUN_DIR}/pgbackrest" "$config"
grep -qx '\[cocalc-test-bay\]' "$config"
grep -qx "pg1-path=${COCALC_BAY_POSTGRES_DATA_DIR}" "$config"
! grep -q 'access-key\|secret-key\|cipher-pass' "$config"

fake_postgres="${TMP_ROOT}/fake-postgres"
cat > "$fake_postgres" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' "$@" > "$COCALC_TEST_POSTGRES_ARGS"
EOF
chmod 0755 "$fake_postgres"
export COCALC_TEST_POSTGRES_ARGS="${TMP_ROOT}/postgres-args"
export COCALC_BAY_POSTGRES_CMD="$fake_postgres -D $COCALC_BAY_POSTGRES_DATA_DIR"
bash "${SCRIPT_DIR}/bay-postgres-run"
grep -qx 'archive_mode=on' "$COCALC_TEST_POSTGRES_ARGS"
grep -qx 'archive_timeout=60s' "$COCALC_TEST_POSTGRES_ARGS"
grep -q 'bay-pgbackrest-archive-push %p' "$COCALC_TEST_POSTGRES_ARGS"

fake_pgbackrest="${TMP_ROOT}/fake-pgbackrest"
cat > "$fake_pgbackrest" <<'EOF'
#!/usr/bin/env bash
if [[ " $* " == *" info "* ]]; then
  printf '%s\n' '[{"name":"cocalc-test-bay","archive":[{"id":"16-1","min":"0001","max":"0002"}],"backup":[{"label":"full-1","type":"full","error":false,"timestamp":{"stop":1785967000},"info":{"repository":{"delta":1234}}}],"repo":[{"status":{"code":0,"message":"ok"}}]}]'
fi
EOF
chmod 0755 "$fake_pgbackrest"
fake_bin="${TMP_ROOT}/bin"
mkdir -p "$fake_bin"
cat > "${fake_bin}/psql" <<'EOF'
#!/usr/bin/env bash
printf '%s\n' '{"archived_count":4,"failed_count":0,"last_archived_wal":"0002","last_archived_time":"2026-08-05T12:00:00Z","last_failed_wal":null,"last_failed_time":null,"stats_reset":"2026-08-05T00:00:00Z"}'
EOF
chmod 0755 "${fake_bin}/psql"
export PATH="${fake_bin}:${PATH}"
export COCALC_BAY_PGBACKREST_BIN="$fake_pgbackrest"
export COCALC_BAY_PGBACKREST_STATUS_FILE="${TMP_ROOT}/pgbackrest-status.json"
export COCALC_BAY_PGBACKREST_MAX_BACKUP_AGE_S=999999999
bash "${SCRIPT_DIR}/bay-pgbackrest-status" >/dev/null
python3 - "$COCALC_BAY_PGBACKREST_STATUS_FILE" <<'PY'
import json
import sys

with open(sys.argv[1], encoding="utf8") as src:
    status = json.load(src)
assert status["level"] == "ok", status
assert status["backup"]["latest_label"] == "full-1", status
assert status["backup"]["repository_delta_bytes_retained_backups"] == 1234, status
assert status["archive"]["postgres"]["archived_count"] == 4, status
PY

echo "bay pgBackRest configuration tests passed"
