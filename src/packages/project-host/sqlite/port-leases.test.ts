/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL – see LICENSE.md for details
 */

import { closeDatabase, getDatabase } from "@cocalc/lite/hub/sqlite/database";
import {
  acquireProjectPortLease,
  coolDownProjectPortOffset,
  getCoolingProjectPortOffsets,
  getProjectPortLease,
  HTTP_PORT_LEASE_START,
  projectPortLeasePreferredOffset,
  releaseProjectPortLease,
  SSH_PORT_LEASE_START,
} from "./port-leases";
import { deleteProjectLocal, upsertProject } from "./projects";

describe("project port lease sqlite", () => {
  const prevFilename = process.env.COCALC_LITE_SQLITE_FILENAME;
  const projectA = "1fc5e846-547c-4c78-baa3-d0528685eea0";
  const projectB = "72d1e771-99c0-47b2-b8b0-a29d882646a8";
  const projectC = "502bcc4e-f2b4-4450-8646-75d1c2655c01";

  beforeEach(() => {
    process.env.COCALC_LITE_SQLITE_FILENAME = ":memory:";
    closeDatabase();
  });

  afterEach(() => {
    closeDatabase();
    if (prevFilename == null) {
      delete process.env.COCALC_LITE_SQLITE_FILENAME;
    } else {
      process.env.COCALC_LITE_SQLITE_FILENAME = prevFilename;
    }
  });

  it("reuses a stable lease for the same project", () => {
    upsertProject({ project_id: projectA, state: "opened" });
    const first = acquireProjectPortLease(projectA);
    const second = acquireProjectPortLease(projectA);
    const preferred = projectPortLeasePreferredOffset(projectA);

    expect(second).toMatchObject(first);
    expect(first.ssh_port).toBe(SSH_PORT_LEASE_START + preferred);
    expect(first.http_port).toBe(HTTP_PORT_LEASE_START + preferred);
  });

  it("avoids ports currently used by running projects without leases", () => {
    upsertProject({
      project_id: projectA,
      state: "running",
      ssh_port:
        SSH_PORT_LEASE_START + projectPortLeasePreferredOffset(projectB),
      http_port:
        HTTP_PORT_LEASE_START + projectPortLeasePreferredOffset(projectB),
    });
    upsertProject({ project_id: projectB, state: "opened" });

    const lease = acquireProjectPortLease(projectB);

    expect(lease.ssh_port).toBe(
      SSH_PORT_LEASE_START + projectPortLeasePreferredOffset(projectB) + 1,
    );
    expect(lease.http_port).toBe(
      HTTP_PORT_LEASE_START + projectPortLeasePreferredOffset(projectB) + 1,
    );
  });

  it("rotates to a fresh lease when requested", () => {
    upsertProject({ project_id: projectA, state: "opened" });
    upsertProject({ project_id: projectB, state: "opened" });
    acquireProjectPortLease(projectB);

    const first = acquireProjectPortLease(projectA);
    const rotated = acquireProjectPortLease(projectA, { rotate: true });

    expect(rotated.ssh_port).not.toBe(first.ssh_port);
    expect(rotated.http_port).not.toBe(first.http_port);
  });

  it("skips explicitly avoided offsets", () => {
    upsertProject({ project_id: projectA, state: "opened" });

    const lease = acquireProjectPortLease(projectA, {
      avoidOffsets: [
        projectPortLeasePreferredOffset(projectA),
        projectPortLeasePreferredOffset(projectA) + 1,
        projectPortLeasePreferredOffset(projectA) + 2,
      ],
    });

    expect(lease.ssh_port).toBe(
      SSH_PORT_LEASE_START + projectPortLeasePreferredOffset(projectA) + 3,
    );
    expect(lease.http_port).toBe(
      HTTP_PORT_LEASE_START + projectPortLeasePreferredOffset(projectA) + 3,
    );
  });

  it("skips cooled-down offsets", () => {
    upsertProject({ project_id: projectA, state: "opened" });
    const preferred = projectPortLeasePreferredOffset(projectA);
    coolDownProjectPortOffset(preferred);
    coolDownProjectPortOffset(preferred + 1);

    const lease = acquireProjectPortLease(projectA);

    expect(getCoolingProjectPortOffsets()).toEqual(
      new Set([preferred, preferred + 1]),
    );
    expect(lease.ssh_port).toBe(SSH_PORT_LEASE_START + preferred + 2);
    expect(lease.http_port).toBe(HTTP_PORT_LEASE_START + preferred + 2);
  });

  it("drops expired cooled-down offsets", () => {
    upsertProject({ project_id: projectA, state: "opened" });
    const preferred = projectPortLeasePreferredOffset(projectA);
    coolDownProjectPortOffset(preferred, { ttlMs: -1 });

    const lease = acquireProjectPortLease(projectA);

    expect(getCoolingProjectPortOffsets()).toEqual(new Set());
    expect(lease.ssh_port).toBe(SSH_PORT_LEASE_START + preferred);
    expect(lease.http_port).toBe(HTTP_PORT_LEASE_START + preferred);
  });

  it("releases the lease when the local project row is deleted", () => {
    upsertProject({ project_id: projectC, state: "opened" });
    acquireProjectPortLease(projectC);
    expect(getProjectPortLease(projectC)).toBeDefined();

    deleteProjectLocal(projectC);

    expect(getProjectPortLease(projectC)).toBeUndefined();
  });

  it("explicit release removes the lease row", () => {
    upsertProject({ project_id: projectA, state: "opened" });
    acquireProjectPortLease(projectA);

    releaseProjectPortLease(projectA);

    expect(getProjectPortLease(projectA)).toBeUndefined();
  });

  it("allocates by indexed probes with 10K existing leases", () => {
    upsertProject({ project_id: projectA, state: "opened" });
    expect(getProjectPortLease(projectA)).toBeUndefined();
    const db = getDatabase();
    const preferred = projectPortLeasePreferredOffset(projectA);
    const insert = db.prepare(
      `INSERT INTO project_port_leases(
         project_id, ssh_port, http_port, updated_at
       ) VALUES (?, ?, ?, ?)`,
    );
    db.exec("BEGIN");
    try {
      let inserted = 0;
      for (let offset = 0; offset < 15_000 && inserted < 10_000; offset += 1) {
        if (offset === preferred) continue;
        insert.run(
          `existing-${offset}`,
          SSH_PORT_LEASE_START + offset,
          HTTP_PORT_LEASE_START + offset,
          Date.now(),
        );
        inserted += 1;
      }
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }

    const lease = acquireProjectPortLease(projectA);
    expect(lease.ssh_port).toBe(SSH_PORT_LEASE_START + preferred);
    expect(lease.http_port).toBe(HTTP_PORT_LEASE_START + preferred);
  });
});
