/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

const describePglite =
  process.env.COCALC_TEST_USE_PGLITE === "1" ? describe : describe.skip;

describePglite("project archive lifecycle schema", () => {
  const originalEnv = {
    COCALC_DB: process.env.COCALC_DB,
    COCALC_PGLITE_DATA_DIR: process.env.COCALC_PGLITE_DATA_DIR,
  };

  beforeAll(async () => {
    process.env.COCALC_DB = "pglite";
    process.env.COCALC_PGLITE_DATA_DIR = "memory://";
  });

  afterAll(async () => {
    const { closePglite } = await import("@cocalc/database/pglite");
    await closePglite();
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value == null) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  });

  it("creates the candidate index with an immutable activity expression", async () => {
    const getPool = (await import("@cocalc/database/pool")).default;
    const { createIndexesQueries } =
      await import("@cocalc/database/postgres/schema/indexes");
    const { SCHEMA } = await import("@cocalc/util/db-schema");
    const pool = getPool();
    await pool.query(`
      CREATE TABLE projects (
        project_id UUID PRIMARY KEY,
        last_edited TIMESTAMPTZ,
        created TIMESTAMPTZ,
        deleted BOOLEAN,
        provisioned BOOLEAN,
        deletion_protection BOOLEAN,
        state JSONB
      )
    `);

    const index = createIndexesQueries(SCHEMA.projects).find(
      ({ name }) => name === "projects_archive_lifecycle_candidates_idx",
    );
    expect(index).toBeDefined();
    await expect(
      pool.query(`CREATE INDEX ${index!.name} ON projects ${index!.query}`),
    ).resolves.toBeDefined();
    const { rows } = await pool.query<{ indexdef: string }>(`
      SELECT indexdef
        FROM pg_indexes
       WHERE indexname = 'projects_archive_lifecycle_candidates_idx'
    `);
    expect(rows[0]?.indexdef).toContain("to_timestamp");
  });
});
