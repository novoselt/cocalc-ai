/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

async function candidateIndex() {
  const { createIndexesQueries } =
    await import("@cocalc/database/postgres/schema/indexes");
  const { SCHEMA } = await import("@cocalc/util/db-schema");
  return createIndexesQueries(SCHEMA.projects).find(
    ({ name }) => name === "projects_archive_lifecycle_candidates_idx",
  );
}

describe("project archive lifecycle schema declaration", () => {
  it("uses a timezone-free immutable candidate ordering expression", async () => {
    const index = await candidateIndex();
    expect(index).toBeDefined();
    expect(index!.query).toContain("make_timestamp(1970, 1, 1, 0, 0, 0)");
    expect(index!.query).not.toContain("timestamptz");
    expect(index!.query).not.toContain("to_timestamp");
  });
});

// PGlite rejects make_timestamp in index expressions even though PostgreSQL
// marks it immutable. Exercise the real DDL in the PostgreSQL test lane.
const describePostgres =
  process.env.COCALC_TEST_USE_PGLITE === "1" ? describe.skip : describe;

describePostgres("project archive lifecycle PostgreSQL schema", () => {
  it("creates the declared candidate index", async () => {
    const getPool = (await import("@cocalc/database/pool")).default;
    const client = await getPool().connect();
    try {
      await client.query(`
        CREATE TEMP TABLE archive_lifecycle_projects_probe (
          project_id UUID PRIMARY KEY,
          last_edited TIMESTAMP,
          created TIMESTAMP,
          deleted BOOLEAN,
          provisioned BOOLEAN,
          deletion_protection BOOLEAN,
          state JSONB
        )
      `);
      const index = await candidateIndex();
      await expect(
        client.query(
          `CREATE INDEX archive_lifecycle_projects_probe_idx ` +
            `ON archive_lifecycle_projects_probe ${index!.query}`,
        ),
      ).resolves.toBeDefined();
    } finally {
      await client.query(
        "DROP TABLE IF EXISTS archive_lifecycle_projects_probe",
      );
      client.release();
    }
  });
});
