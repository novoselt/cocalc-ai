# PostgreSQL Dual Schema Ownership Audit

Date: 2026-08-09

## Executive Summary

CoCalc's startup `db-schema` synchronizer is the intended owner of durable
PostgreSQL tables, columns, primary keys, and indexes. The server tree still has
31 tables that are also created by feature-local `CREATE TABLE IF NOT EXISTS`
code. This is genuine schema ownership debt: the two definitions can drift, and
index definitions can be dropped and recreated at startup or silently collide
by name.

Growth analytics was removed from this list in this change. Its defaults,
nullability, null backfills, columns, keys, and indexes are now all declarative.

A CI test now contains an exact debt allowlist. A newly introduced dual-owned
table fails the test; removing a runtime bootstrap also requires removing its
allowlist entry, so progress is visible.

## Synchronizer Capability Added

Field metadata now supports:

- `pg_default`: trusted PostgreSQL default expression, applied on create/add and
  converged for existing columns.
- `not_null: true`: applied on create/add and converged for existing columns.
- `pg_null_backfill`: explicit expression used to repair legacy null rows before
  applying `NOT NULL`.

The declarations are intentionally one-way and opt-in. Omitting `pg_default` or
`not_null` leaves the existing invariant unmanaged; it does not drop a default
or make a column nullable. This avoids reinterpreting the large existing schema.

Defaults should use PostgreSQL's normalized spelling, such as `now()`, because
the synchronizer compares them with `information_schema.columns.column_default`
before issuing DDL.

## Remaining Dual-Owned Tables

### Accounts and authentication (4)

- `account_admin_audit_log`
- `account_ban_audit_log`
- `account_resource_quarantine_audit_log`
- `email_auth_challenges`

The audit logs are good early cleanup candidates. Email challenges also contain
incremental column/data migrations and should retain a migration function after
its table creation and indexes move fully into `db-schema`.

### Projects and public shares (6)

- `deleted_projects`
- `project_access_request_blocks`
- `project_access_requests`
- `public_project_path_slugs`
- `public_project_paths`
- `legacy_migration_public_share_replay_events`

These modules mix bootstrap DDL with retention fields, legacy column additions,
partial indexes, and data repair. Move indexes and supported column invariants
first; keep named migration steps for renames/backfills that are not steady-state
schema declarations.

### Project backups and RootFS (4)

- `project_backup_indexes`
- `project_backup_repos`
- `project_rootfs_builds`
- `rootfs_rustic_repos`

These have lifecycle status defaults/checks and incremental migrations. Defaults
and nullability can now move declaratively. Check constraints need synchronizer
support or an explicit migration before runtime bootstrap removal.

`project_backup_repo_assignments` remains an intentionally ad hoc table and is
not a dual-ownership conflict because it is not yet in `db-schema`.

### Membership and licensing (13)

- `membership_analytics_daily_counts`
- `membership_analytics_events`
- `membership_claim_identities`
- `membership_claim_scopes`
- `project_entitlement_override_events`
- `project_entitlement_overrides`
- `site_license_audit_log`
- `site_license_external_claim_consumptions`
- `site_license_external_claim_keys`
- `site_license_external_claim_pools`
- `site_license_managers`
- `site_license_pool_requests`
- `site_licenses`

This is the largest cluster and should be migrated module-by-module. Site
licensing in particular has foreign keys, checks, uniqueness, and historical
ALTER migrations; it should not be converted by mechanical deletion.

### Exam hosts (2)

- `project_host_exam_configs`
- `project_host_exam_runs`

The runtime code explicitly repairs legacy nullable/default state and renames old
fields. Defaults and nullability can now be declared centrally; legacy renames
should remain as a small, separately named migration.

### Legacy account migration (2)

- `legacy_migration_account_link_events`
- `legacy_migration_financial_claims`

Keep historical data migrations, but move the final steady-state table and index
shape to `db-schema`.

## Still Unsupported Centrally

The synchronizer does not yet fully converge:

- named `CHECK` constraints on existing columns/tables;
- foreign keys;
- existing `UNIQUE` column constraints (custom unique indexes are supported);
- removing a declared default or dropping `NOT NULL`;
- column deletion or rename (renames must remain explicit migrations);
- varchar length and array type changes, which are intentionally not detected;
- generated columns and more general table-level constraints.

The next useful generic feature is named check-constraint convergence. Foreign
keys should follow only after deciding how startup handles validation and locks
on large production tables.

## Recommended Cleanup Order

1. Account audit logs and membership analytics: simple schemas, low migration
   risk, and immediate removal of duplicated indexes.
2. Project entitlement/access tables and exam tables: move defaults/nullability,
   retain narrowly scoped legacy migrations.
3. Backup and RootFS tables: add named check-constraint support first.
4. Email authentication and public sharing: preserve their existing data repair
   semantics while separating migrations from schema declaration.
5. Site licensing and legacy migration: handle last with focused integration
   tests because they contain the richest constraints and historical state.

For each module, the completion criterion is: no runtime `CREATE TABLE` or
steady-state `CREATE INDEX` for a `db-schema` table; a second
`schemaNeedsSync()` call is false; any remaining runtime SQL is an explicitly
named, idempotent data/rename migration.
