import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { PersistMaintenanceCatalog } from "@cocalc/backend/conat/persist-maintenance/catalog";
import { PersistMaintenancePathSafety } from "@cocalc/backend/conat/persist-maintenance/path-safety";
import type { PersistMaintenanceUse } from "@cocalc/conat/persist/maintenance/types";

describe("persist maintenance catalog and path safety", () => {
  let root: string;
  let catalog: PersistMaintenanceCatalog;
  let catalogPath: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "persist-maintenance-catalog-"));
    catalogPath = join(root, ".maintenance", "catalog.sqlite");
    catalog = new PersistMaintenanceCatalog(catalogPath);
  });

  afterEach(async () => {
    catalog.close();
    await rm(root, { recursive: true, force: true });
  });

  function use(physicalPath: string): PersistMaintenanceUse {
    return {
      logicalPath: "hub/test",
      physicalPath,
      scopeType: "hub",
      ownerId: randomUUID(),
      pid: process.pid,
      processStartToken: "test",
      workerId: "0",
    };
  }

  it("tracks every open generation and removes the owner only on final close", () => {
    const path = join(root, "test.db");
    const first = use(path);
    expect(catalog.beginOpen(first)).toBe(1);
    expect(catalog.getDatabase(path)?.open_owners).toBe(1);

    const db = new DatabaseSync(path);
    db.exec("CREATE TABLE t(x)");
    db.close();
    catalog.closed({ ...first, dirty: true });
    expect(catalog.getDatabase(path)).toMatchObject({
      generation: 1,
      open_owners: 0,
      presence_state: "present",
    });

    const second = { ...first };
    expect(catalog.beginOpen(second)).toBe(2);
    expect(catalog.getDatabase(path)?.open_owners).toBe(1);
    catalog.openFailed(second);
    expect(catalog.getDatabase(path)?.open_owners).toBe(0);
  });

  it("treats vanished catalog paths as state and never recreates them", () => {
    const path = join(root, "deleted.db");
    const tracked = use(path);
    catalog.beginOpen(tracked);
    catalog.openFailed(tracked);
    catalog.markMissing(path);
    expect(catalog.getDatabase(path)?.presence_state).toBe("missing");
    expect(existsSync(path)).toBe(false);
  });

  it("rejects files and parent directories reached through symlinks", () => {
    const outside = join(root, "outside");
    const allowed = join(root, "allowed");
    mkdirSync(outside);
    mkdirSync(allowed);
    writeFileSync(join(outside, "outside.db"), "not sqlite");
    symlinkSync(outside, join(allowed, "link"));
    const safety = new PersistMaintenancePathSafety({
      rootTemplates: [allowed],
      catalogPath,
    });
    expect(() =>
      safety.assertExistingRegularFile(join(allowed, "link", "outside.db")),
    ).toThrow(/resolves elsewhere|symlink/);
  });

  it("detects replacement identity and clears stale page statistics", () => {
    const path = join(root, "replace.db");
    writeFileSync(path, "first");
    const first = require("node:fs").lstatSync(path);
    catalog.observeFile(path, {
      device: Number(first.dev),
      inode: Number(first.ino),
      sizeBytes: first.size,
      mtimeMs: first.mtimeMs,
      walSizeBytes: 0,
    });
    catalog.updateInspection(
      path,
      {
        device: Number(first.dev),
        inode: Number(first.ino),
        sizeBytes: first.size,
        mtimeMs: first.mtimeMs,
        walSizeBytes: 0,
      },
      {
        pageSize: 4096,
        pageCount: 10,
        freelistCount: 5,
        reclaimableBytes: 20_480,
        quickCheck: "ok",
      },
    );
    rmSync(path);
    writeFileSync(path, "replacement-is-longer");
    const replacement = require("node:fs").lstatSync(path);
    catalog.observeFile(path, {
      device: Number(replacement.dev),
      inode: Number(replacement.ino),
      sizeBytes: replacement.size,
      mtimeMs: replacement.mtimeMs,
      walSizeBytes: 0,
    });
    expect(catalog.getDatabase(path)).toMatchObject({
      generation: 1,
      reclaimable_bytes: null,
      last_inspected_at: null,
    });
  });
});
