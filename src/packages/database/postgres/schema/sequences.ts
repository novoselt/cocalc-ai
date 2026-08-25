/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import type { Client } from "@cocalc/database/pool";
import { quoteIdentifier } from "./index-metadata";
import type { DBSchema } from "./types";

function desiredSequences(dbSchema: DBSchema): string[] {
  const names = Object.values(dbSchema).flatMap(
    (schema) => schema.pg_sequences ?? [],
  );
  const duplicates = names.filter(
    (name, index) => names.indexOf(name) !== index,
  );
  if (duplicates.length > 0) {
    throw new Error(
      `database sequences must be declared once: ${[...new Set(duplicates)].join(", ")}`,
    );
  }
  return names;
}

async function hasSequence(db: Client, name: string): Promise<boolean> {
  const { rows } = await db.query(
    `SELECT EXISTS (
       SELECT 1
         FROM pg_class AS sequence
         JOIN pg_namespace AS namespace ON namespace.oid=sequence.relnamespace
        WHERE sequence.relkind='S'
          AND sequence.relname=$1
          AND namespace.nspname=current_schema()
     ) AS exists`,
    [name],
  );
  return rows[0]?.exists === true;
}

export async function schemaSequencesNeedSync(
  db: Client,
  dbSchema: DBSchema,
): Promise<boolean> {
  for (const sequence of desiredSequences(dbSchema)) {
    if (!(await hasSequence(db, sequence))) return true;
  }
  return false;
}

export async function syncSchemaSequences(
  db: Client,
  dbSchema: DBSchema,
): Promise<void> {
  for (const sequence of desiredSequences(dbSchema)) {
    if (await hasSequence(db, sequence)) continue;
    await db.query(`CREATE SEQUENCE ${quoteIdentifier(sequence)}`);
  }
}

export const __test__ = { desiredSequences, hasSequence };
