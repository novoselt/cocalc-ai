/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { Client } from "@cocalc/database/pool";
import type { DBSchema } from "./types";

type Queryable = Pick<Client, "query">;

async function columnType(
  db: Queryable,
  table: string,
  column: string,
): Promise<string | undefined> {
  const { rows } = await db.query(
    `SELECT data_type FROM information_schema.columns
      WHERE table_schema='public' AND table_name=$1 AND column_name=$2`,
    [table, column],
  );
  return rows[0]?.data_type;
}

async function rowCount(db: Queryable, table: string): Promise<number> {
  const { rows } = await db.query(`SELECT count(*)::text count FROM ${table}`);
  return Number(rows[0]?.count ?? 0);
}

async function replaceEmptyIntegerReference(
  db: Queryable,
  table: string,
  column: string,
): Promise<void> {
  const type = await columnType(db, table, column);
  if (type !== "integer" && type !== "bigint") return;
  const { rows } = await db.query(
    `SELECT count(*)::text count FROM ${table} WHERE ${column} IS NOT NULL`,
  );
  const count = Number(rows[0]?.count ?? 0);
  if (count !== 0) {
    throw Error(
      `refusing CRM schema cleanup: ${table}.${column} has ${count} legacy references`,
    );
  }
  await db.query(`ALTER TABLE ${table} DROP COLUMN ${column}`);
  await db.query(`ALTER TABLE ${table} ADD COLUMN ${column} UUID`);
}

/**
 * Remove the never-used integer CRM schema before declarative schema sync.
 *
 * This must run before syncTableSchema: PostgreSQL cannot directly cast the old
 * integer identities or references to the canonical UUID types. Every drop is
 * guarded by an exact zero-row check, so an unexpected deployment fails closed.
 */
export async function cleanupLegacyCrmBeforeSchemaSync(
  db: Queryable,
  dbSchema: DBSchema,
): Promise<void> {
  if (dbSchema.crm_organizations?.fields.id?.type !== "uuid") return;

  const legacyTables = [
    "crm_support_messages",
    "crm_support_tickets",
    "crm_tags",
    "crm_leads",
  ];
  for (const table of ["crm_organizations", "crm_people", "crm_tasks"]) {
    const type = await columnType(db, table, "id");
    if (type === "integer" || type === "bigint") legacyTables.push(table);
  }
  const existingLegacyTables: string[] = [];
  for (const table of legacyTables) {
    if (!(await columnType(db, table, "id"))) continue;
    const count = await rowCount(db, table);
    if (count !== 0) {
      throw Error(
        `refusing CRM schema cleanup: legacy ${table} contains ${count} rows`,
      );
    }
    existingLegacyTables.push(table);
  }
  if (existingLegacyTables.length) {
    await db.query(`DROP TABLE ${existingLegacyTables.join(",")} CASCADE`);
  }

  if (dbSchema.commercial_orders?.fields.crm_organization_id?.type === "uuid") {
    await replaceEmptyIntegerReference(
      db,
      "commercial_orders",
      "crm_organization_id",
    );
  }
  if (
    dbSchema.commercial_order_contacts?.fields.crm_person_id?.type === "uuid"
  ) {
    await replaceEmptyIntegerReference(
      db,
      "commercial_order_contacts",
      "crm_person_id",
    );
  }
}

export const __test__ = { columnType, replaceEmptyIntegerReference, rowCount };
