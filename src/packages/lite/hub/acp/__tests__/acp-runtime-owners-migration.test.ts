/*
 * This file is part of CoCalc: Copyright (C) 2026 Sagemath, Inc.
 * License: MS-RSL - see LICENSE.md for details
 */

import {
  closeAcpDatabase,
  getAcpDatabase,
  initAcpDatabase,
} from "../../sqlite/acp-database";

describe("ACP retained runtime ownership migration", () => {
  beforeAll(() => {
    closeAcpDatabase();
    initAcpDatabase({ filename: ":memory:" });
    getAcpDatabase().exec(`
      CREATE TABLE acp_runtime_owners (
        session_id TEXT PRIMARY KEY,
        worker_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        account_id TEXT,
        path TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      INSERT INTO acp_runtime_owners VALUES
        ('cloned-session', 'worker-1', 'project-1', NULL, NULL, 1, 1);
    `);
  });

  afterAll(() => {
    closeAcpDatabase();
  });

  it("migrates the legacy global session key to a project-scoped key", async () => {
    // Import after creating the legacy schema so its lazy initialization runs
    // the same migration that an existing project host runs on upgrade.
    const { getAcpRuntimeOwner, upsertAcpRuntimeOwner } =
      await import("../../sqlite/acp-runtime-owners");

    upsertAcpRuntimeOwner({
      session_id: "cloned-session",
      worker_id: "worker-2",
      project_id: "project-2",
    });

    expect(
      getAcpRuntimeOwner({
        project_id: "project-1",
        session_id: "cloned-session",
      })?.worker_id,
    ).toBe("worker-1");
    expect(
      getAcpRuntimeOwner({
        project_id: "project-2",
        session_id: "cloned-session",
      })?.worker_id,
    ).toBe("worker-2");
  });
});
