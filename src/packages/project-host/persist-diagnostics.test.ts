/*
 *  This file is part of CoCalc: Copyright © 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import {
  collectProjectHostPersistDiagnostics,
  isLoopbackRemoteAddress,
} from "./persist-diagnostics";

describe("project-host conat-persist diagnostics", () => {
  it("collects cheap process and path-free stream aggregates by default", () => {
    const diagnostics = collectProjectHostPersistDiagnostics({
      ready: true,
      serverId: "0",
    });

    expect(diagnostics.schema_version).toBe(1);
    expect(diagnostics.ready).toBe(true);
    expect(diagnostics.server_id).toBe("0");
    expect(diagnostics.process.pid).toBe(process.pid);
    expect(diagnostics.process.memory.rss).toBeGreaterThan(0);
    expect(diagnostics.v8.heap.heap_size_limit).toBeGreaterThan(0);
    expect(
      diagnostics.conat.persistence.local_streams.open_total,
    ).toBeGreaterThanOrEqual(0);
    expect(diagnostics.conat.persistence).not.toHaveProperty("sqlite_detail");
    expect(JSON.stringify(diagnostics)).not.toContain(process.cwd());
  });

  it("only performs per-database SQLite queries when explicitly requested", () => {
    const diagnostics = collectProjectHostPersistDiagnostics({
      includePersistenceDetail: true,
    });

    expect(diagnostics.conat.persistence.sqlite_detail).toEqual(
      expect.objectContaining({
        ephemeral: expect.objectContaining({
          databases: 0,
          wal_bytes: 0,
          shm_bytes: 0,
        }),
        disk: expect.objectContaining({
          databases: 0,
          wal_bytes: 0,
          shm_bytes: 0,
        }),
        duration_ms: expect.any(Number),
      }),
    );
  });

  it("publishes path-free maintenance file and WAL aggregates", () => {
    const diagnostics = collectProjectHostPersistDiagnostics({
      maintenance: {
        enabled: true,
        dryRun: true,
        catalogHealthy: true,
        trackingCoverage: true,
        openPaths: 12,
        presentDatabases: 34,
        missingDatabases: 1,
        unverifiedDatabases: 2,
        presentFileBytes: 5_000,
        presentWalBytes: 600,
        lastScanCompletedAt: 1234,
        scannedFiles: 34,
      },
    });

    expect(diagnostics.conat.persistence.maintenance).toEqual(
      expect.objectContaining({
        present_databases: 34,
        present_file_bytes: 5_000,
        present_wal_bytes: 600,
      }),
    );
    expect(JSON.stringify(diagnostics)).not.toContain("catalogPath");
  });

  it("recognizes IPv4, IPv6, and mapped loopback peers", () => {
    expect(isLoopbackRemoteAddress("127.0.0.1")).toBe(true);
    expect(isLoopbackRemoteAddress("::1")).toBe(true);
    expect(isLoopbackRemoteAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isLoopbackRemoteAddress("::1%lo")).toBe(true);
    expect(isLoopbackRemoteAddress("10.0.0.1")).toBe(false);
    expect(isLoopbackRemoteAddress()).toBe(false);
  });
});
