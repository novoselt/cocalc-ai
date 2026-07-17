import { mkdirSync, rmSync, symlinkSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { PersistMaintenanceCatalog } from "@cocalc/backend/conat/persist-maintenance/catalog";
import { PersistMaintenancePathSafety } from "@cocalc/backend/conat/persist-maintenance/path-safety";
import { PersistMaintenanceScanner } from "@cocalc/backend/conat/persist-maintenance/scanner";
import { maintenanceTestConfig } from "@cocalc/backend/conat/test/persist-maintenance/helpers";

describe("persist maintenance bounded scanner", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "persist-maintenance-scanner-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("resumes bounded scans, ignores symlinks, and marks vanished files missing", async () => {
    const data = join(root, "data");
    const outside = join(root, "outside");
    mkdirSync(join(data, "nested"), { recursive: true });
    mkdirSync(outside);
    for (const path of [join(data, "a.db"), join(data, "nested", "b.db")]) {
      const db = new DatabaseSync(path);
      db.exec("CREATE TABLE t(x)");
      db.close();
    }
    symlinkSync(outside, join(data, "outside-link"));
    const catalogPath = join(root, "catalog", "catalog.sqlite");
    const config = {
      ...maintenanceTestConfig({ root: data, catalogPath, dryRun: true }),
      scanEntryLimit: 1,
    };
    const catalog = new PersistMaintenanceCatalog(catalogPath);
    const scanner = new PersistMaintenanceScanner(
      catalog,
      new PersistMaintenancePathSafety({
        rootTemplates: [data],
        catalogPath,
      }),
      config,
    );
    let result;
    do {
      result = await scanner.scanBatch();
    } while (!result.complete);
    expect(catalog.listDatabases()).toHaveLength(2);

    rmSync(join(data, "a.db"));
    catalog.setState("scan_completed_at", "0");
    do {
      result = await scanner.scanBatch();
    } while (!result.complete);
    expect(catalog.getDatabase(join(data, "a.db"))?.presence_state).toBe(
      "missing",
    );
    expect(
      catalog.getDatabase(join(data, "nested", "b.db"))?.presence_state,
    ).toBe("present");
    catalog.close();
  });
});
