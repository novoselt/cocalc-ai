/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import getLogger from "@cocalc/backend/logger";
import getPool from "@cocalc/database/pool";

const logger = getLogger("server:database:concurrent-index");

type ConcurrentIndexState = {
  indisready: boolean;
  indisvalid: boolean;
};

type ConcurrentIndexClient = {
  query: (
    sql: string,
    params?: readonly unknown[],
  ) => Promise<{ rows: unknown[] }>;
  release: () => void;
};

function quoteIdentifier(name: string): string {
  if (!/^[a-z_][a-z0-9_]*$/i.test(name)) {
    throw new Error(`invalid PostgreSQL index name '${name}'`);
  }
  return `"${name}"`;
}

async function getIndexState(
  client: ConcurrentIndexClient,
  name: string,
): Promise<ConcurrentIndexState | undefined> {
  const { rows } = await client.query(
    `
      SELECT index.indisready, index.indisvalid
      FROM pg_index AS index
      WHERE index.indexrelid = to_regclass($1)
    `,
    [name],
  );
  return rows[0] as ConcurrentIndexState | undefined;
}

export async function createIndexConcurrentlyBestEffort({
  name,
  sql,
}: {
  name: string;
  sql: string;
}): Promise<void> {
  const pool = getPool();
  if (typeof (pool as any).connect !== "function") {
    await pool.query(sql.replace("CREATE INDEX CONCURRENTLY", "CREATE INDEX"));
    return;
  }

  const client = (await (pool as any).connect()) as ConcurrentIndexClient;
  let locked = false;
  let statementTimeoutDisabled = false;
  try {
    const { rows } = await client.query(
      "SELECT pg_try_advisory_lock(hashtext($1)) AS locked",
      [name],
    );
    locked = (rows[0] as { locked?: boolean } | undefined)?.locked === true;
    if (!locked) {
      return;
    }

    // Building a large index can legitimately take much longer than the
    // request-oriented statement timeout configured on pooled connections.
    await client.query("SET statement_timeout = 0");
    statementTimeoutDisabled = true;

    const state = await getIndexState(client, name);
    if (state && (!state.indisready || !state.indisvalid)) {
      logger.warn("dropping invalid concurrent index before rebuilding", {
        index: name,
        indisready: state.indisready,
        indisvalid: state.indisvalid,
      });
      await client.query(
        `DROP INDEX CONCURRENTLY IF EXISTS ${quoteIdentifier(name)}`,
      );
    }

    await client.query(sql);
    const installed = await getIndexState(client, name);
    if (!installed?.indisready || !installed.indisvalid) {
      throw new Error(`concurrent index '${name}' is not ready and valid`);
    }
  } catch (err) {
    logger.warn("failed to create concurrent index", {
      index: name,
      err: `${err}`,
    });
  } finally {
    if (statementTimeoutDisabled) {
      await client.query("RESET statement_timeout").catch(() => undefined);
    }
    if (locked) {
      await client
        .query("SELECT pg_advisory_unlock(hashtext($1))", [name])
        .catch(() => undefined);
    }
    client.release();
  }
}
