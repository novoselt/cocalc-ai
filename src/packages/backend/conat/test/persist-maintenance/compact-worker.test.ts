import { statSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { runPersistMaintenanceWorker } from "@cocalc/backend/conat/persist-maintenance/compact-worker";
import {
  createBloatedDatabase,
  quickCheck,
} from "@cocalc/backend/conat/test/persist-maintenance/helpers";

describe("persist SQLite compact-copy worker", () => {
  let root: string;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "persist-maintenance-worker-"));
  });

  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it("builds and validates a smaller copy without changing the source", async () => {
    const sourcePath = join(root, "source.db");
    const outputPath = join(root, ".source.db.compact-test.tmp");
    createBloatedDatabase(sourcePath);
    const sourceBefore = statSync(sourcePath);

    const result = await runPersistMaintenanceWorker({
      sourcePath,
      outputPath,
      timeoutMs: 60_000,
    });

    expect(result.beforeStats.quickCheck).toBe("ok");
    expect(result.beforeStats.reclaimableBytes).toBeGreaterThan(0);
    expect(result.outputStats?.quickCheck).toBe("ok");
    expect(statSync(outputPath).size).toBeLessThan(sourceBefore.size);
    expect(statSync(sourcePath).size).toBe(sourceBefore.size);
    expect(statSync(sourcePath).ino).toBe(sourceBefore.ino);
    expect(quickCheck(sourcePath)).toBe("ok");

    const output = new DatabaseSync(outputPath, { readOnly: true });
    expect(output.prepare("SELECT COUNT(*) AS n FROM payload").get()).toEqual({
      n: 1,
    });
    output.close();
  });
});
