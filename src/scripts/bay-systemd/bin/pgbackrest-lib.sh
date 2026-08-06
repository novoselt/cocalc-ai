#!/usr/bin/env bash

pgbackrest_set_defaults() {
  : "${COCALC_BAY_PGBACKREST_BIN:=/usr/local/bin/pgbackrest}"
  : "${COCALC_BAY_PGBACKREST_CONFIG:=${COCALC_BAY_BACKUP_DIR}/pgbackrest/pgbackrest.conf}"
  : "${COCALC_BAY_PGBACKREST_SPOOL_PATH:=${COCALC_BAY_BACKUP_DIR}/pgbackrest/spool}"
  : "${COCALC_BAY_PGBACKREST_LOCK_PATH:=${COCALC_BAY_RUN_DIR}/pgbackrest}"
  : "${COCALC_BAY_PGBACKREST_STATUS_FILE:=${COCALC_BAY_STATE_DIR}/pgbackrest-status.json}"
  : "${COCALC_BAY_PGBACKREST_MAX_BACKUP_AGE_S:=129600}"
  : "${COCALC_BAY_PGBACKREST_MAX_SPOOL_AGE_S:=600}"
  : "${COCALC_BAY_PGBACKREST_MAX_WAL_BACKLOG_BYTES:=8589934592}"
}

pgbackrest_runtime_preflight() {
  if [[ ! -x "$COCALC_BAY_PGBACKREST_BIN" ]]; then
    bay_log "pgBackRest binary is not executable: $COCALC_BAY_PGBACKREST_BIN"
    return 1
  fi
  if ! "$COCALC_BAY_PGBACKREST_BIN" version >/dev/null 2>&1; then
    bay_log "pgBackRest binary cannot run; verify its runtime libraries: $COCALC_BAY_PGBACKREST_BIN"
    return 1
  fi
}

pgbackrest_export_secrets() {
  require_var COCALC_BAY_PGBACKREST_S3_ACCESS_KEY
  require_var COCALC_BAY_PGBACKREST_S3_SECRET_KEY
  require_var COCALC_BAY_PGBACKREST_CIPHER_PASS
  export PGBACKREST_REPO1_S3_KEY="$COCALC_BAY_PGBACKREST_S3_ACCESS_KEY"
  export PGBACKREST_REPO1_S3_KEY_SECRET="$COCALC_BAY_PGBACKREST_S3_SECRET_KEY"
  export PGBACKREST_REPO1_CIPHER_PASS="$COCALC_BAY_PGBACKREST_CIPHER_PASS"
}

pgbackrest_stanza() {
  printf 'cocalc-%s' "${COCALC_BAY_ID//[^A-Za-z0-9_-]/-}"
}
