/*
 *  This file is part of CoCalc: Copyright (c) 2026 Sagemath, Inc.
 *  License: MS-RSL - see LICENSE.md for details
 */

import { loadPersistMaintenanceConfig } from "./config";
import { runPersistMaintenanceWorker } from "./compact-worker";
import { PersistMaintenancePathSafety } from "./path-safety";

export async function inspectPersistDatabase(path: string) {
  const config = loadPersistMaintenanceConfig();
  const safety = new PersistMaintenancePathSafety({
    rootTemplates: config.rootTemplates,
    catalogPath: config.catalogPath,
  });
  const checked = safety.assertExistingRegularFile(path);
  return await runPersistMaintenanceWorker({
    sourcePath: checked.path,
    timeoutMs: Math.min(config.jobTimeoutMs, 5 * 60 * 1000),
  });
}

if (require.main === module) {
  const path = process.argv[2];
  if (!path) {
    process.stderr.write(
      "usage: node inspect.js /absolute/path/to/persist-database.db\n",
    );
    process.exit(2);
  }
  inspectPersistDatabase(path)
    .then((result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    })
    .catch((err) => {
      process.stderr.write(`${err?.stack ?? err}\n`);
      process.exit(1);
    });
}
