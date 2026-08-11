/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { createHash } from "node:crypto";
import getLogger from "@cocalc/backend/logger";
import type { Client } from "@cocalc/database/pool";
import { createIndexesQueries } from "./indexes";
import {
  addSchemaIndexMarker,
  postgresIdentifierName,
  quoteIdentifier,
  quoteLiteral,
  schemaIndexHash,
  schemaIndexMarkers,
  staleSchemaIndexComment,
  STALE_INDEX_MARKER,
  type SchemaIndexDefinition,
} from "./index-metadata";
import type { TableSchema } from "./types";

const log = getLogger("db:schema:index-convergence");
let probeId = 0;

type CurrentIndex = {
  oid: string;
  name: string;
  comment: string | null;
  constraint_name: string | null;
  primary: boolean;
  ready: boolean;
  valid: boolean;
  unique: boolean;
  exclusion: boolean;
  method: string;
  key_count: number;
  column_count: number;
  nulls_not_distinct: boolean;
  columns: string[];
  collations: string;
  operator_classes: string;
  options: string;
  expressions: string | null;
  predicate: string | null;
};

export type IndexAction =
  | { action: "reconcile"; index: SchemaIndexDefinition }
  | { action: "delete"; name: string };

async function getCurrentIndexes(
  db: Client,
  table: string,
): Promise<CurrentIndex[]> {
  const { rows } = await db.query(
    `SELECT index_class.oid::text AS oid,
            index_class.relname AS name,
            obj_description(index_class.oid, 'pg_class') AS comment,
            constraint_row.conname AS constraint_name,
            index_row.indisprimary AS primary,
            index_row.indisready AS ready,
            index_row.indisvalid AS valid,
            index_row.indisunique AS unique,
            index_row.indisexclusion AS exclusion,
            access_method.amname AS method,
            index_row.indnkeyatts AS key_count,
            index_row.indnatts AS column_count,
            COALESCE(
              (to_jsonb(index_row)->>'indnullsnotdistinct')::boolean,
              false
            ) AS nulls_not_distinct,
            ARRAY(
              SELECT pg_get_indexdef(index_row.indexrelid, position, false)
                FROM generate_series(1, index_row.indnatts) AS position
               ORDER BY position
            ) AS columns,
            index_row.indcollation::text AS collations,
            index_row.indclass::text AS operator_classes,
            index_row.indoption::text AS options,
            pg_get_expr(index_row.indexprs, index_row.indrelid, false) AS expressions,
            pg_get_expr(index_row.indpred, index_row.indrelid, false) AS predicate
       FROM pg_index AS index_row
       JOIN pg_class AS index_class
         ON index_class.oid=index_row.indexrelid
       JOIN pg_am AS access_method
         ON access_method.oid=index_class.relam
       LEFT JOIN pg_constraint AS constraint_row
         ON constraint_row.conindid=index_class.oid
      WHERE index_row.indrelid=to_regclass($1)`,
    [table],
  );
  return rows.map((row) => ({ ...row, oid: `${row.oid}` })) as CurrentIndex[];
}

function structuralFingerprint(index: CurrentIndex): string {
  return JSON.stringify({
    unique: index.unique,
    exclusion: index.exclusion,
    method: index.method,
    key_count: Number(index.key_count),
    column_count: Number(index.column_count),
    nulls_not_distinct: index.nulls_not_distinct,
    columns: index.columns,
    collations: index.collations,
    operator_classes: index.operator_classes,
    options: index.options,
    expressions: index.expressions,
    predicate: index.predicate,
  });
}

function expectedName(index: SchemaIndexDefinition): string {
  return postgresIdentifierName(index.name);
}

export async function getIndexActions(
  db: Client,
  schema: TableSchema,
): Promise<IndexAction[]> {
  const current = await getCurrentIndexes(db, schema.name);
  const desired = createIndexesQueries(schema);
  const desiredHashes = new Set(desired.map(schemaIndexHash));
  const desiredNames = new Set(desired.map(expectedName));
  const actions: IndexAction[] = [];

  for (const index of desired) {
    const hash = schemaIndexHash(index);
    const sameName = current.find(({ name }) => name === expectedName(index));
    if (sameName != null) {
      if (
        sameName.primary ||
        sameName.constraint_name != null ||
        !sameName.ready ||
        !sameName.valid ||
        !schemaIndexMarkers(sameName.comment).has(hash)
      ) {
        actions.push({ action: "reconcile", index });
      }
      continue;
    }
    const equivalentManagedIndex = current.some(
      ({ comment, ready, valid }) =>
        ready && valid && schemaIndexMarkers(comment).has(hash),
    );
    if (!equivalentManagedIndex) {
      actions.push({ action: "reconcile", index });
    }
  }

  for (const index of current) {
    const markers = schemaIndexMarkers(index.comment);
    if (
      markers.has(STALE_INDEX_MARKER) ||
      (markers.size > 0 &&
        [...markers].every((marker) => !desiredHashes.has(marker)))
    ) {
      // A same-name index queued for repair is handled by the atomic swap.
      if (!desiredNames.has(index.name)) {
        actions.push({ action: "delete", name: index.name });
      }
    }
  }
  return actions;
}

async function desiredFingerprints(
  db: Client,
  schema: TableSchema,
  desired: SchemaIndexDefinition[],
): Promise<Map<string, string>> {
  const fingerprints = new Map<string, string>();
  const unique = new Map(
    desired.map((index) => [schemaIndexHash(index), index]),
  );
  if (unique.size === 0) return fingerprints;

  probeId += 1;
  const probe = postgresIdentifierName(
    `cocalc_index_probe_${process.pid}_${probeId}`,
  );
  const qProbe = quoteIdentifier(probe);
  await db.query(
    `CREATE TEMP TABLE ${qProbe} (LIKE ${quoteIdentifier(
      schema.name,
    )} INCLUDING ALL EXCLUDING INDEXES)`,
  );
  try {
    const probeNames = new Map<string, string>();
    let indexId = 0;
    for (const [hash, index] of unique) {
      indexId += 1;
      const name = postgresIdentifierName(`${probe}_${indexId}`);
      probeNames.set(name, hash);
      await db.query(
        `CREATE ${index.unique ? "UNIQUE " : ""}INDEX ${quoteIdentifier(
          name,
        )} ON ${qProbe} ${index.query}`,
      );
    }
    const probeIndexes = await getCurrentIndexes(db, `pg_temp.${probe}`);
    for (const index of probeIndexes) {
      const hash = probeNames.get(index.name);
      if (hash != null) {
        fingerprints.set(hash, structuralFingerprint(index));
      }
    }
    if (fingerprints.size !== unique.size) {
      throw new Error(
        `failed to canonicalize all declared indexes for ${schema.name}`,
      );
    }
    return fingerprints;
  } finally {
    await db.query(`DROP TABLE ${qProbe}`);
  }
}

async function commentOnIndex(
  db: Client,
  index: CurrentIndex,
  hash: string,
): Promise<void> {
  const comment = addSchemaIndexMarker(index.comment, hash);
  await db.query(
    `COMMENT ON INDEX ${quoteIdentifier(index.name)} IS ${quoteLiteral(comment)}`,
  );
}

function supportsConcurrentIndexes(): boolean {
  return process.env.COCALC_DB !== "pglite";
}

async function dropIndex(db: Client, name: string): Promise<void> {
  const concurrently = supportsConcurrentIndexes() ? " CONCURRENTLY" : "";
  await db.query(
    `DROP INDEX${concurrently} IF EXISTS ${quoteIdentifier(name)}`,
  );
}

async function createIndex(
  db: Client,
  schema: TableSchema,
  index: SchemaIndexDefinition,
  name: string,
): Promise<void> {
  const concurrently = supportsConcurrentIndexes() ? " CONCURRENTLY" : "";
  await db.query(
    `CREATE ${index.unique ? "UNIQUE " : ""}INDEX${concurrently} ${quoteIdentifier(
      name,
    )} ON ${quoteIdentifier(schema.name)} ${index.query}`,
  );
}

function internalIndexName(prefix: string, ...parts: string[]): string {
  const digest = createHash("sha256")
    .update(parts.join("\0"))
    .digest("hex")
    .slice(0, 24);
  return postgresIdentifierName(`cocalc_${prefix}_${digest}`);
}

function assertReplaceable(index: CurrentIndex): void {
  if (index.primary || index.constraint_name != null) {
    throw new Error(
      `cannot replace index ${index.name}: it is owned by ${
        index.constraint_name == null
          ? "a primary key"
          : `constraint ${index.constraint_name}`
      }`,
    );
  }
}

async function rebuildSameNameIndex({
  db,
  schema,
  desired,
  current,
  fingerprint,
}: {
  db: Client;
  schema: TableSchema;
  desired: SchemaIndexDefinition;
  current: CurrentIndex;
  fingerprint: string;
}): Promise<void> {
  assertReplaceable(current);
  const hash = schemaIndexHash(desired);
  const replacementName = internalIndexName(
    "index_rebuild",
    schema.name,
    expectedName(desired),
    hash,
  );
  let indexes = await getCurrentIndexes(db, schema.name);
  let replacement = indexes.find(({ name }) => name === replacementName);
  if (
    replacement != null &&
    (!replacement.ready ||
      !replacement.valid ||
      structuralFingerprint(replacement) !== fingerprint)
  ) {
    assertReplaceable(replacement);
    await dropIndex(db, replacement.name);
    replacement = undefined;
  }
  if (replacement == null) {
    await createIndex(db, schema, desired, replacementName);
    indexes = await getCurrentIndexes(db, schema.name);
    replacement = indexes.find(({ name }) => name === replacementName);
  }
  if (
    replacement == null ||
    !replacement.ready ||
    !replacement.valid ||
    structuralFingerprint(replacement) !== fingerprint
  ) {
    throw new Error(
      `replacement index ${replacementName} for ${schema.name} is not valid and structurally correct`,
    );
  }

  const staleName = internalIndexName(
    "index_stale",
    schema.name,
    current.name,
    current.oid,
  );
  await db.query("BEGIN");
  try {
    await db.query(
      `COMMENT ON INDEX ${quoteIdentifier(current.name)} IS ${quoteLiteral(
        staleSchemaIndexComment(),
      )}`,
    );
    await db.query(
      `ALTER INDEX ${quoteIdentifier(current.name)} RENAME TO ${quoteIdentifier(
        staleName,
      )}`,
    );
    await db.query(
      `ALTER INDEX ${quoteIdentifier(
        replacement.name,
      )} RENAME TO ${quoteIdentifier(expectedName(desired))}`,
    );
    await db.query(
      `COMMENT ON INDEX ${quoteIdentifier(
        expectedName(desired),
      )} IS ${quoteLiteral(addSchemaIndexMarker(null, hash))}`,
    );
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK").catch(() => undefined);
    throw err;
  }
  await dropIndex(db, staleName);
}

async function reconcileIndex({
  db,
  schema,
  desired,
  fingerprint,
}: {
  db: Client;
  schema: TableSchema;
  desired: SchemaIndexDefinition;
  fingerprint: string;
}): Promise<void> {
  const hash = schemaIndexHash(desired);
  let current = await getCurrentIndexes(db, schema.name);
  const sameName = current.find(({ name }) => name === expectedName(desired));
  if (sameName != null) {
    assertReplaceable(sameName);
    if (
      sameName.ready &&
      sameName.valid &&
      structuralFingerprint(sameName) === fingerprint
    ) {
      await commentOnIndex(db, sameName, hash);
      return;
    }
    await rebuildSameNameIndex({
      db,
      schema,
      desired,
      current: sameName,
      fingerprint,
    });
    return;
  }

  const equivalent = current.find(
    (index) =>
      !index.primary &&
      index.constraint_name == null &&
      index.ready &&
      index.valid &&
      structuralFingerprint(index) === fingerprint,
  );
  if (equivalent != null) {
    await commentOnIndex(db, equivalent, hash);
    return;
  }

  await createIndex(db, schema, desired, expectedName(desired));
  current = await getCurrentIndexes(db, schema.name);
  const created = current.find(({ name }) => name === expectedName(desired));
  if (
    created == null ||
    !created.ready ||
    !created.valid ||
    structuralFingerprint(created) !== fingerprint
  ) {
    throw new Error(
      `created index ${desired.name} for ${schema.name} is not valid and structurally correct`,
    );
  }
  await commentOnIndex(db, created, hash);
}

export async function syncTableSchemaIndexes(
  db: Client,
  schema: TableSchema,
): Promise<void> {
  const actions = await getIndexActions(db, schema);
  if (actions.length === 0) return;
  log.info("converging table indexes", { table: schema.name, actions });

  const reconcile = actions
    .filter(
      (action): action is Extract<IndexAction, { action: "reconcile" }> =>
        action.action === "reconcile",
    )
    .map(({ index }) => index);
  const fingerprints = await desiredFingerprints(db, schema, reconcile);
  if (supportsConcurrentIndexes()) {
    await db.query("SET statement_timeout = 0");
  }
  try {
    for (const action of actions) {
      if (action.action === "delete") {
        await dropIndex(db, action.name);
        continue;
      }
      const hash = schemaIndexHash(action.index);
      const fingerprint = fingerprints.get(hash);
      if (fingerprint == null) {
        throw new Error(
          `missing canonical definition for ${schema.name}.${action.index.name}`,
        );
      }
      await reconcileIndex({
        db,
        schema,
        desired: action.index,
        fingerprint,
      });
    }
  } finally {
    if (supportsConcurrentIndexes()) {
      await db.query("RESET statement_timeout").catch(() => undefined);
    }
  }
}
