/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import type { Client } from "@cocalc/database/pool";
import { PglitePool } from "@cocalc/database/pool/pglite";
import type { TableSchema } from "./types";
import {
  notNullGuardName,
  syncTableSchemaColumnInvariants,
} from "./column-invariants";

function invariantSchema(table: string, backfill?: string): TableSchema {
  return {
    name: table,
    primary_key: "id",
    fields: {
      id: { type: "integer" },
      value: {
        type: "string",
        not_null: true,
        pg_null_backfill: backfill,
      },
    },
  };
}

function clientFor(db: PglitePool, queries: string[] = []): Client {
  return {
    connect: async () => undefined,
    end: async () => undefined,
    query: async (text: string, values?: any[]) => {
      queries.push(text);
      return await db.query(text, values);
    },
  } as unknown as Client;
}

describe("declarative NOT NULL migration", () => {
  let db: PglitePool;

  beforeEach(() => {
    db = new PglitePool();
  });

  afterEach(async () => {
    await db.end();
  });

  it("guards writes, backfills in batches, validates, and promotes", async () => {
    await db.query(
      "CREATE TABLE invariant_batch_test (id integer PRIMARY KEY, value text)",
    );
    await db.query(`
      INSERT INTO invariant_batch_test (id, value)
      SELECT value, NULL FROM generate_series(1, 10001) AS value
    `);
    const queries: string[] = [];

    await syncTableSchemaColumnInvariants(
      clientFor(db, queries),
      invariantSchema("invariant_batch_test", "'repaired'"),
    );

    const guardIndex = queries.findIndex((query) =>
      query.includes("ADD CONSTRAINT"),
    );
    const backfillIndex = queries.findIndex((query) =>
      query.includes("WITH batch AS MATERIALIZED"),
    );
    const validateIndex = queries.findIndex((query) =>
      query.includes("VALIDATE CONSTRAINT"),
    );
    const promoteIndex = queries.findIndex((query) =>
      query.includes('ALTER COLUMN "value" SET NOT NULL'),
    );
    expect(guardIndex).toBeGreaterThanOrEqual(0);
    expect(backfillIndex).toBeGreaterThan(guardIndex);
    expect(validateIndex).toBeGreaterThan(backfillIndex);
    expect(promoteIndex).toBeGreaterThan(validateIndex);
    expect(
      queries.filter((query) => query.includes("WITH batch AS MATERIALIZED")),
    ).toHaveLength(3);

    const nulls = await db.query(
      "SELECT count(*)::int AS count FROM invariant_batch_test WHERE value IS NULL",
    );
    expect(nulls.rows[0]).toEqual({ count: 0 });
    const column = await db.query(
      `SELECT is_nullable
         FROM information_schema.columns
        WHERE table_name='invariant_batch_test' AND column_name='value'`,
    );
    expect(column.rows[0]).toEqual({ is_nullable: "NO" });
    const guards = await db.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid='invariant_batch_test'::regclass
          AND conname LIKE 'cocalc_nn_%'`,
    );
    expect(guards.rows).toEqual([]);
  });

  it("resumes from an installed guard and a partial backfill", async () => {
    const table = "invariant_resume_test";
    const guard = notNullGuardName(table, "value");
    await db.query(
      `CREATE TABLE ${table} (id integer PRIMARY KEY, value text)`,
    );
    await db.query(
      `INSERT INTO ${table} VALUES (1, NULL), (2, NULL), (3, 'ok')`,
    );
    await db.query(`ALTER TABLE ${table}
      ADD CONSTRAINT ${guard} CHECK (value IS NOT NULL) NOT VALID`);
    await db.query(`UPDATE ${table} SET value='partial' WHERE id=1`);

    await syncTableSchemaColumnInvariants(
      clientFor(db),
      invariantSchema(table, "'resumed'"),
    );

    const { rows } = await db.query(`SELECT value FROM ${table} ORDER BY id`);
    expect(rows).toEqual([
      { value: "partial" },
      { value: "resumed" },
      { value: "ok" },
    ]);
  });

  it("leaves the write guard in place when no backfill is declared", async () => {
    const table = "invariant_missing_backfill_test";
    await db.query(
      `CREATE TABLE ${table} (id integer PRIMARY KEY, value text)`,
    );
    await db.query(`INSERT INTO ${table} VALUES (1, NULL)`);

    await expect(
      syncTableSchemaColumnInvariants(clientFor(db), invariantSchema(table)),
    ).rejects.toThrow("declare pg_null_backfill");
    await expect(
      db.query(`INSERT INTO ${table} VALUES (2, NULL)`),
    ).rejects.toMatchObject({ code: "23514" });
  });

  it("cleans up a guard left after NOT NULL was promoted", async () => {
    const table = "invariant_cleanup_test";
    const guard = notNullGuardName(table, "value");
    await db.query(
      `CREATE TABLE ${table} (id integer PRIMARY KEY, value text NOT NULL)`,
    );
    await db.query(`ALTER TABLE ${table}
      ADD CONSTRAINT ${guard} CHECK (value IS NOT NULL) NOT VALID`);

    await syncTableSchemaColumnInvariants(
      clientFor(db),
      invariantSchema(table, "'unused'"),
    );

    const { rows } = await db.query(
      `SELECT conname FROM pg_constraint
        WHERE conrelid=$1::regclass AND conname=$2`,
      [table, guard],
    );
    expect(rows).toEqual([]);
  });
});
